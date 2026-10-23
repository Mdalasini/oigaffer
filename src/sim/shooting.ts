// Shooting: how good a chance looks to the shooter, where to aim, striking
// the ball, and headers.

import { kick } from './actions'
import { BALL_RADIUS, GRAVITY } from './constants'
import { pressureAt } from './evaluate'
import { atan2, clamp, cos, exp, sin } from './fmath'
import { believe, type Belief } from './perception'
import { GOAL_HEIGHT, GOAL_WIDTH, HALF_LENGTH } from './pitch'
import { gauss } from './rng'
import { attackDir, roleOf, teamOf, type Sim } from './sim'

/** Nobody shoots from further out than this. */
export const MAX_SHOT_DISTANCE = 32

export interface ShotPlan {
  /** Aim point on the goal line. */
  x: number
  y: number
  z: number
  xg: number
}

const seen: Belief = { x: 0, y: 0, vx: 0, vy: 0 }

/** The goal a team attacks: x of its line. */
export function targetGoalX(sim: Sim, team: number): number {
  return attackDir(sim, team) * HALF_LENGTH
}

/** Angle (radians) the goal mouth subtends from (x, y) for a team shooting at its target goal. */
export function goalAngle(sim: Sim, team: number, x: number, y: number): number {
  const gx = targetGoalX(sim, team)
  const dx = Math.abs(gx - x)
  const a = atan2(GOAL_WIDTH / 2 - y, dx) - atan2(-GOAL_WIDTH / 2 - y, dx)
  return Math.abs(a)
}

/**
 * The shooter's estimate of the chance a shot from (x, y) goes in: distance
 * and angle to goal, bodies in the way, pressure, and their own skill.
 */
export function estimateXg(sim: Sim, shooter: number, x: number, y: number): number {
  const team = teamOf(sim, shooter)
  const gx = targetGoalX(sim, team)
  const d = Math.sqrt((gx - x) * (gx - x) + y * y)
  if (d > MAX_SHOT_DISTANCE || (x - gx) * attackDir(sim, team) > 0) return 0
  const theta = goalAngle(sim, team, x, y)
  let xg = Math.min(0.65, 1 / (1 + exp(-(-1.4 + 3 * theta - 0.11 * d))))
  // Defenders in the triangle between the ball and the posts block the shot;
  // a keeper in it narrows the angle, more the closer they have come.
  for (const o of sim.teams[1 - team]) {
    believe(sim, shooter, o, seen)
    if (!inShotTriangle(seen.x, seen.y, x, y, gx)) continue
    if (roleOf(sim, o) !== 'GK') xg *= 0.6
    else {
      const out = Math.sqrt((seen.x - x) * (seen.x - x) + (seen.y - y) * (seen.y - y))
      xg *= clamp(0.45 + out * 0.05, 0.45, 1)
    }
  }
  const { Attr } = sim.c
  xg *= 0.6 + 0.4 * clamp(pressureAt(sim, shooter, x, y) / 3, 0, 1)
  xg *= (0.7 + 0.6 * Attr.shooting[shooter]) * (0.85 + 0.3 * Attr.composure[shooter])
  return xg
}

function inShotTriangle(px: number, py: number, x: number, y: number, gx: number): boolean {
  const span = gx - x
  const t = (px - x) / span
  if (t <= 0.02 || t >= 1) return false
  const half = (GOAL_WIDTH / 2 + 0.3) * t
  const cy = y + (0 - y) * t
  return Math.abs(py - cy) < half + 0.4
}

/** Aim for the corner further from where the shooter thinks the keeper is. */
export function planShot(sim: Sim, shooter: number, x: number, y: number): ShotPlan {
  const team = teamOf(sim, shooter)
  const gx = targetGoalX(sim, team)
  const keeper = sim.teams[1 - team].find((e) => roleOf(sim, e) === 'GK')!
  believe(sim, shooter, keeper, seen)
  const side = seen.y > 0 ? -1 : 1
  const aimY = side * (GOAL_WIDTH / 2 - 0.75)
  // Low unless the keeper is well off their line, when it goes over them.
  const off = Math.abs(gx - seen.x)
  const aimZ = off > 4 ? 1.9 : 0.35
  return { x: gx, y: aimY, z: aimZ, xg: estimateXg(sim, shooter, x, y) }
}

/** Strikes a shot at the plan's aim point; error grows with distance, pressure and a first-time strike. */
export function strikeShot(sim: Sim, shooter: number, plan: ShotPlan, firstTime: boolean): void {
  const { Pos, Attr } = sim.c
  const bx = Pos.x[sim.ball]
  const by = Pos.y[sim.ball]
  const dx = plan.x - bx
  const dy = plan.y - by
  const d = Math.sqrt(dx * dx + dy * dy)
  const speed = (22 + 9 * Attr.shooting[shooter]) * (firstTime ? 0.9 : 1)
  const pressure = clamp((3 - pressureAt(sim, shooter, bx, by)) / 3, 0, 1)
  const sigma = (0.045 + 0.08 * (1 - Attr.shooting[shooter])) * (1 + pressure * 0.6) * (firstTime ? 1.3 : 1) * (1 + d / 40)
  const a = atan2(dy, dx) + gauss(sim.m.rng) * sigma
  const t = d / speed
  // Launch so the ball is at the aim height as it reaches the line.
  const z = plan.z + gauss(sim.m.rng) * sigma * d * 0.6
  const vz = Math.max(0, (z - BALL_RADIUS + 0.5 * GRAVITY * t * t) / t)
  kick(sim, shooter, cos(a) * speed, sin(a) * speed, vz, 'shot', -1, { firstTime })
}

/** Highest ball a player can head, jumping. */
export function headerHeight(sim: Sim, eid: number): number {
  return 2.2 + 0.4 * sim.c.Attr.strength[eid]
}

/**
 * Meets a ball in the air with the head: at goal in the attacking box,
 * clear and high in or near their own box, otherwise on towards the
 * opponent's goal.
 */
export function header(sim: Sim, eid: number): void {
  const { Pos, Attr } = sim.c
  const team = teamOf(sim, eid)
  const dir = attackDir(sim, team)
  const bx = Pos.x[sim.ball]
  const by = Pos.y[sim.ball]
  const ax = bx * dir
  const gx = targetGoalX(sim, team)
  const toGoal = Math.sqrt((gx - bx) * (gx - bx) + by * by)
  if (toGoal < 16) {
    const aimY = clamp(-by * 0.3, -GOAL_WIDTH / 2 + 0.6, GOAL_WIDTH / 2 - 0.6)
    const a = atan2(aimY - by, gx - bx) + gauss(sim.m.rng) * (0.08 + 0.1 * (1 - Attr.shooting[eid]))
    const speed = 11 + 6 * Attr.strength[eid]
    return kick(sim, eid, cos(a) * speed, sin(a) * speed, -1, 'header')
  }
  const defensive = ax < -HALF_LENGTH + 30
  const a = atan2(defensive ? (by > 0 ? 1 : -1) * 0.6 : -by * 0.01, dir) + gauss(sim.m.rng) * 0.3
  const speed = defensive ? 14 + 6 * Attr.strength[eid] : 9 + 4 * Attr.passing[eid]
  kick(sim, eid, cos(a) * speed, sin(a) * speed, defensive ? 6 : 3, 'header')
}

/** True if (x, y, z) is inside the goal mouth a shot is aimed at, with a margin. */
export function onTarget(y: number, z: number, margin = 0): boolean {
  return Math.abs(y) < GOAL_WIDTH / 2 + margin && z < GOAL_HEIGHT + margin
}

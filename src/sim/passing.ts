// Passing: which passes a player believes are on, how good each is, and
// striking them. Every candidate is flown with the real ball integrator and
// checked against when each opponent could get to it.

import { kick } from './actions'
import { BALL_RADIUS, CONTROL_HEIGHT, DT, FOOT_REACH } from './constants'
import { arrivalSample, interceptRisk, lossValue, pitchValue } from './evaluate'
import { atan2, clamp, cos, sin } from './fmath'
import { airKick, createFlight, FLIGHT_STRIDE, groundKickSpeed, simulateFlight } from './kicks'
import { acceleration, runTime, topSpeed } from './movement'
import { release } from './keeper'
import { believe, type Belief } from './perception'
import { HALF_LENGTH, HALF_WIDTH } from './pitch'
import { gauss } from './rng'
import { attackDir, roleOf, teamOf, type Sim } from './sim'

export const PassType = {
  /** Along the ground to the receiver's feet. */
  Ground: 0,
  /** Along the ground into space for the receiver to run onto. */
  Through: 1,
  /** In the air over anyone in the way. */
  Lofted: 2,
  /** In the air from a wide position into the box. */
  Cross: 3,
  /** Hard and low across the face of goal. */
  DrivenCross: 4,
} as const
export type PassType = (typeof PassType)[keyof typeof PassType]
export const PASS_NAMES = ['ground', 'through', 'lofted', 'cross', 'driven-cross'] as const

export interface PassPlan {
  type: PassType
  target: number
  x: number
  y: number
  /** Expected worth of playing it: success-weighted pitch value minus the cost of losing the ball. */
  score: number
  /** Chance the pass reaches the receiver, as the passer sees it. */
  success: number
}

/** Exact launch speeds (horizontal, vertical) for a pass type over a distance. */
function solveLaunch(type: PassType, d: number): [number, number] {
  if (type === PassType.Lofted || type === PassType.Cross) {
    const apex = type === PassType.Cross ? clamp(2 + d * 0.1, 3.5, 6) : clamp(3 + d * 0.12, 4, 14)
    const { vh, vz } = airKick(d, apex)
    return [vh, vz]
  }
  const arrive = type === PassType.Through ? 5 + d * 0.05 : type === PassType.DrivenCross ? 9 : 3.5 + d * 0.08
  return [Math.min(30, groundKickSpeed(d, arrive)), 0]
}

// Solving a launch takes dozens of trial flights, too many to repeat for every
// candidate pass, so speeds are solved once per whole metre and interpolated.
const LAUNCH_TABLE_MAX = 80
const launchTable = new Map<number, [number, number]>()

function tabled(type: PassType, metre: number): [number, number] {
  const key = type * 1000 + metre
  let v = launchTable.get(key)
  if (!v) {
    v = solveLaunch(type, Math.max(1, metre))
    launchTable.set(key, v)
  }
  return v
}

/** Launch velocity that sends a pass of the given type from one point to another. */
export function launch(type: PassType, fx: number, fy: number, tx: number, ty: number): [number, number, number] {
  const dx = tx - fx
  const dy = ty - fy
  const d = Math.sqrt(dx * dx + dy * dy) || 1
  const ux = dx / d
  const uy = dy / d
  const lo = Math.min(LAUNCH_TABLE_MAX - 1, Math.floor(d))
  const t = Math.min(1, d - lo)
  const a = tabled(type, lo)
  const b = tabled(type, lo + 1)
  const vh = a[0] + (b[0] - a[0]) * t
  const vz = a[1] + (b[1] - a[1]) * t
  return [ux * vh, uy * vh, vz]
}

const flight = createFlight()
const mate: Belief = { x: 0, y: 0, vx: 0, vy: 0 }

/**
 * Best pass the passer believes is on with the ball at (bx, by), or null.
 * `only` restricts the search to one receiver (used for return passes).
 */
export function bestPass(sim: Sim, passer: number, bx: number, by: number, only = -1, groundOnly = false): PassPlan | null {
  const team = teamOf(sim, passer)
  const dir = attackDir(sim, team)
  const opponents = sim.teams[1 - team]
  const wide = bx * dir > 22 && Math.abs(by) > 14
  const loss = lossValue(sim, team, bx, by)
  let best: PassPlan | null = null

  const consider = (type: PassType, target: number, x: number, y: number) => {
    if (Math.abs(x) > HALF_LENGTH - 0.5 || Math.abs(y) > HALF_WIDTH - 0.5) return
    const [vx, vy, vz] = launch(type, bx, by, x, y)
    simulateFlight(flight, bx, by, vx, vy, vz)
    const s = arrivalSample(flight, x, y, 1.5, CONTROL_HEIGHT)
    if (s < 0) return
    const tBall = s * FLIGHT_STRIDE * DT
    const reach = Math.sqrt((x - mate.x) * (x - mate.x) + (y - mate.y) * (y - mate.y)) - FOOT_REACH
    const speed = Math.sqrt(mate.vx * mate.vx + mate.vy * mate.vy)
    const tMate = 0.15 + runTime(reach, speed, topSpeed(sim, target), acceleration(sim, target))
    const late = clamp((tMate - tBall - 0.2) / 0.8, 0, 1)
    const risk = interceptRisk(sim, passer, opponents, flight, s, target, mate.x, mate.y, mate.vx, mate.vy)
    // Balls in the air are harder to land on the spot and to control.
    const aerial = vz > 0 ? 0.8 + 0.15 * sim.c.Attr.passing[passer] : 1
    const success = (1 - risk) * (1 - late) * aerial
    const score = success * pitchValue(sim, team, x, y) - (1 - success) * loss
    if (!best || score > best.score) best = { type, target, x, y, score, success }
  }

  for (const t of sim.teams[team]) {
    if (t === passer || (only >= 0 && t !== only)) continue
    believe(sim, passer, t, mate)
    const d0 = Math.sqrt((mate.x - bx) * (mate.x - bx) + (mate.y - by) * (mate.y - by))
    if (d0 < 4 || d0 > 60) continue
    const keeper = roleOf(sim, t) === 'GK'
    // Lead the receiver by roughly the ball's travel time.
    const lead = d0 / 15
    const lx = mate.x + mate.vx * lead
    const ly = mate.y + mate.vy * lead
    if (d0 <= 40) consider(PassType.Ground, t, lx, ly)
    if (keeper) continue
    const speed = Math.sqrt(mate.vx * mate.vx + mate.vy * mate.vy)
    // Through balls are for players already running forwards.
    const rx = speed > 2 ? mate.vx / speed : 0
    const ry = speed > 2 ? mate.vy / speed : 0
    if (rx * dir > 0.3) {
      for (const len of [6, 11, 16]) consider(PassType.Through, t, mate.x + rx * len, mate.y + ry * len)
    }
    if (groundOnly) continue
    if (d0 >= 18) consider(PassType.Lofted, t, mate.x + mate.vx * lead * 1.4, mate.y + mate.vy * lead * 1.4)
    if (wide && mate.x * dir > HALF_LENGTH - 20 && Math.abs(mate.y) < 14) {
      consider(PassType.Cross, t, mate.x + mate.vx, mate.y + mate.vy)
      consider(PassType.DrivenCross, t, mate.x + mate.vx * 0.6, mate.y + mate.vy * 0.6)
    }
  }
  return best
}

export interface StrikeContext {
  firstTime: boolean
  /** Distance to the nearest opponent the passer is aware of. */
  pressure: number
}

/** Strikes a planned pass from wherever the ball is now, with error that grows with difficulty. */
export function strikePass(sim: Sim, passer: number, plan: PassPlan, ctx: StrikeContext): void {
  const { Pos, Attr, Facing } = sim.c
  // A keeper's distribution: rolled out, thrown, or kicked out of the hands.
  let name: string = PASS_NAMES[plan.type]
  if (sim.m.ball.inHands) {
    const d = Math.sqrt((plan.x - Pos.x[passer]) * (plan.x - Pos.x[passer]) + (plan.y - Pos.y[passer]) * (plan.y - Pos.y[passer]))
    name = plan.type === PassType.Ground ? 'rollout' : d < 35 ? 'throw' : 'punt'
    release(sim)
  }
  const bx = Pos.x[sim.ball]
  const by = Pos.y[sim.ball]
  const [vx, vy, vz] = launch(plan.type, bx, by, plan.x, plan.y)
  const d = Math.sqrt((plan.x - bx) * (plan.x - bx) + (plan.y - by) * (plan.y - by))
  const angle = atan2(vy, vx)
  // Striking across the body is harder than striking where you face.
  const across = (1 - cos(angle - Facing.a[passer])) / 2
  const difficulty =
    (1.15 - Attr.passing[passer]) *
    (1 + (ctx.firstTime ? 0.6 : 0)) *
    (1 + clamp((3 - ctx.pressure) / 3, 0, 1) * 0.5) *
    (1 + across * 0.6) *
    (1 + d / 50)
  const a = angle + gauss(sim.m.rng) * 0.04 * difficulty
  const power = 1 + gauss(sim.m.rng) * 0.05 * difficulty
  const h = Math.sqrt(vx * vx + vy * vy) * power
  // Knocking the ball past a defender is a long touch to yourself.
  const kind = plan.target === passer ? 'knock-on' : 'pass'
  kick(sim, passer, cos(a) * h, sin(a) * h, vz * power, kind, plan.target, kind === 'pass' ? { pass: name, firstTime: ctx.firstTime } : {})
}

/** True if the ball is close enough to the player's feet to strike. */
export function canStrike(sim: Sim, eid: number): boolean {
  const { Pos, Air } = sim.c
  const dx = Pos.x[sim.ball] - Pos.x[eid]
  const dy = Pos.y[sim.ball] - Pos.y[eid]
  return dx * dx + dy * dy <= (FOOT_REACH + BALL_RADIUS) * (FOOT_REACH + BALL_RADIUS) && Air.z[sim.ball] <= CONTROL_HEIGHT
}

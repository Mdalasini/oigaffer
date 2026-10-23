// Goalkeeping: narrowing the angle, reacting to shots with a dive, catching
// or parrying what comes within reach, claiming crosses, smothering at an
// attacker's feet, and getting the ball out again.

import type { BallState } from './ballmotion'
import { DT, TICK_RATE } from './constants'
import { emit } from './events'
import { clamp } from './fmath'
import { IntentKind, setIntent } from './intents'
import { believe, type Belief } from './perception'
import { GOAL_WIDTH, HALF_LENGTH, PENALTY_AREA_DEPTH, PENALTY_AREA_WIDTH } from './pitch'
import { chance, gauss, range } from './rng'
import { PATH_SAMPLES, PATH_STRIDE, predictPath } from './scratch'
import { attackDir, roleOf, teamOf, type Sim } from './sim'
import type { Point } from './shape'
import { readBall } from './systems/ball'

/** How far a keeper's hands reach from their body, standing and at full stretch in a dive. */
const STAND_REACH = 0.9
const DIVE_REACH = 1.5
/** Highest a keeper can take the ball, standing and jumping/diving. */
export const KEEPER_HEIGHT = 2.6
const DIVE_SECONDS = 0.6
const DOWN_SECONDS = 1.3
/** Longest a keeper holds the ball before releasing it. */
const HOLD_SECONDS = 5

const seen: Belief = { x: 0, y: 0, vx: 0, vy: 0 }
const path = new Float64Array(PATH_SAMPLES * 3)
const bs: BallState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }

export function keeperOf(sim: Sim, team: number): number {
  return sim.teams[team].find((e) => roleOf(sim, e) === 'GK')!
}

export function inOwnPenaltyArea(sim: Sim, team: number, x: number, y: number): boolean {
  const ax = x * attackDir(sim, team)
  return ax < -HALF_LENGTH + PENALTY_AREA_DEPTH && ax > -HALF_LENGTH - 1 && Math.abs(y) < PENALTY_AREA_WIDTH / 2
}

export function isDiving(sim: Sim, gk: number): boolean {
  return sim.m.tick < sim.c.Keeper.diveUntil[gk]
}

/** On the ground after a dive: can't move or stand up yet. */
export function isDown(sim: Sim, gk: number): boolean {
  return sim.m.tick >= sim.c.Keeper.diveUntil[gk] && sim.m.tick < sim.c.Keeper.downUntil[gk]
}

/**
 * Where the keeper stands: on the line from the goal centre to where they
 * believe the ball is, further off the line the further away it is.
 */
export function keeperPosition(sim: Sim, gk: number, out: Point): Point {
  const team = teamOf(sim, gk)
  const gx = -attackDir(sim, team) * HALF_LENGTH
  believe(sim, gk, sim.ball, seen)
  const dx = seen.x - gx
  const dy = seen.y
  const d = Math.sqrt(dx * dx + dy * dy) || 1
  const depth = d < 25 ? clamp(1 + d * 0.15, 1, 4.5) : clamp(4.5 + (d - 25) * 0.15, 4.5, 14)
  out.x = gx + (dx / d) * depth
  out.y = clamp((dy / d) * depth, -GOAL_WIDTH / 2 - 1, GOAL_WIDTH / 2 + 1)
  return out
}

/** Runs after players act each tick: keepers react to shots at their goal. */
export function keeperSystem(sim: Sim): void {
  const { m, c } = sim
  for (const e of m.events) {
    if (e.type !== 'kick' || (e.kind !== 'shot' && e.kind !== 'header')) continue
    const gk = keeperOf(sim, 1 - teamOf(sim, e.by))
    planDive(sim, gk)
  }
  for (const team of [0, 1]) {
    const gk = keeperOf(sim, team)
    const at = c.Keeper.diveAt[gk]
    if (at >= 0 && m.tick >= at) {
      c.Keeper.diveAt[gk] = -1
      c.Keeper.diveUntil[gk] = m.tick + Math.round(DIVE_SECONDS * TICK_RATE)
      c.Keeper.downUntil[gk] = m.tick + Math.round(DOWN_SECONDS * TICK_RATE)
      setIntent(sim, gk, IntentKind.Dive, -1, c.Keeper.x[gk], c.Keeper.y[gk])
    }
  }
}

/** Reads the shot's line and, after a reaction delay, dives across to where it will pass. */
function planDive(sim: Sim, gk: number) {
  const { c, m } = sim
  predictPath(path, readBall(sim, bs))
  const gx = c.Pos.x[gk]
  const side = -attackDir(sim, teamOf(sim, gk))
  for (let s = 1; s < PATH_SAMPLES; s++) {
    const x = path[s * 3]
    if ((x - gx) * side < 0) continue
    const y = path[s * 3 + 1]
    const z = path[s * 3 + 2]
    // Going well wide or over: let it go.
    if (Math.abs(y) > GOAL_WIDTH / 2 + 1 || z > KEEPER_HEIGHT + 0.6) return
    const reaction = 0.12 + 0.25 * (1 - c.Attr.reactions[gk])
    const t = s * PATH_STRIDE * DT
    if (t < reaction) return
    c.Keeper.diveAt[gk] = m.tick + Math.round(reaction * TICK_RATE)
    c.Keeper.x[gk] = gx
    c.Keeper.y[gk] = y
    return
  }
}

/**
 * True if an opponent on the ball is through on goal: in the box, close in,
 * and no outfield defender nearer to them than the keeper.
 */
export function shouldRush(sim: Sim, gk: number, carrier: number): boolean {
  const { Pos } = sim.c
  const team = teamOf(sim, gk)
  believe(sim, gk, carrier, seen)
  if (!inOwnPenaltyArea(sim, team, seen.x, seen.y)) return false
  const gx = -attackDir(sim, team) * HALF_LENGTH
  if ((seen.x - gx) * (seen.x - gx) + seen.y * seen.y > 14 * 14) return false
  const mine = (Pos.x[gk] - seen.x) * (Pos.x[gk] - seen.x) + (Pos.y[gk] - seen.y) * (Pos.y[gk] - seen.y)
  for (const d of sim.teams[team]) {
    if (d === gk) continue
    const dd = (Pos.x[d] - seen.x) * (Pos.x[d] - seen.x) + (Pos.y[d] - seen.y) * (Pos.y[d] - seen.y)
    if (dd < mine) return false
  }
  return true
}

/** True if the keeper may use their hands on the ball as it is now. */
export function canHandle(sim: Sim, gk: number): boolean {
  const { m, c, ball } = sim
  const team = teamOf(sim, gk)
  if (isDown(sim, gk) || m.tick < c.Brain.noTouchUntil[gk]) return false
  if (!inOwnPenaltyArea(sim, team, c.Pos.x[ball], c.Pos.y[ball])) return false
  // No hands for a ball deliberately passed back by a teammate.
  return m.ball.backPassTeam !== team
}

/** True if the ball is within the keeper's reach for hands. */
export function inHandsReach(sim: Sim, gk: number): boolean {
  const { Pos, Air } = sim.c
  const dx = Pos.x[sim.ball] - Pos.x[gk]
  const dy = Pos.y[sim.ball] - Pos.y[gk]
  const reach = isDiving(sim, gk) ? DIVE_REACH : STAND_REACH
  return dx * dx + dy * dy <= reach * reach && Air.z[sim.ball] <= KEEPER_HEIGHT
}

/**
 * The keeper gets hands to the ball: hold it, or parry it away when it is
 * too hot to hold. Harder at full stretch and against hard shots.
 */
export function handle(sim: Sim, gk: number): void {
  const { c, m, ball } = sim
  const vx = c.Vel.x[ball]
  const vy = c.Vel.y[ball]
  const vz = c.Air.vz[ball]
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz)
  const hold = clamp(0.35 + 0.65 * c.Attr.keeping[gk] - Math.max(0, speed - 10) / 28 - (isDiving(sim, gk) ? 0.2 : 0), 0.05, 0.97)
  m.ball.lastTouch = gk
  m.ball.lastTeam = teamOf(sim, gk)
  m.ball.lastKick = ''
  m.ball.backPassTeam = -1
  m.ball.touchTick = m.tick
  m.possession = teamOf(sim, gk)
  if (chance(m.rng, hold)) {
    m.ball.owner = gk
    m.ball.inHands = true
    c.Brain.gotBall[gk] = m.tick
    c.Air.z[ball] = 1.2
    c.Air.vz[ball] = 0
    emit(sim, { type: 'save', by: gk, kind: 'catch', speed })
    setIntent(sim, gk, IntentKind.Wait)
    return
  }
  // Parry: knock it back out and away from the middle of the goal.
  const away = c.Pos.y[ball] >= c.Pos.y[gk] ? 1 : -1
  const out = attackDir(sim, teamOf(sim, gk))
  c.Vel.x[ball] = Math.abs(vx) * range(m.rng, 0.15, 0.4) * out
  c.Vel.y[ball] = away * range(m.rng, 3, 7) + gauss(m.rng)
  c.Air.vz[ball] = range(m.rng, 1, 4)
  m.ball.owner = -1
  c.Brain.noTouchUntil[gk] = m.tick + Math.round(0.5 * TICK_RATE)
  emit(sim, { type: 'save', by: gk, kind: 'parry', speed })
}

/** While a keeper holds the ball it stays in their hands, wherever they go. */
export function carryInHands(sim: Sim): void {
  const { c, m, ball } = sim
  const gk = m.ball.owner
  c.Pos.x[ball] = c.Pos.x[gk]
  c.Pos.y[ball] = c.Pos.y[gk]
  c.Air.z[ball] = 1.2
  c.Vel.x[ball] = c.Vel.x[gk]
  c.Vel.y[ball] = c.Vel.y[gk]
  c.Air.vz[ball] = 0
}

/** Seconds a keeper has held the ball. */
export function heldFor(sim: Sim, gk: number): number {
  return (sim.m.tick - sim.c.Brain.gotBall[gk]) * DT
}

export function mustRelease(sim: Sim, gk: number): boolean {
  return heldFor(sim, gk) >= HOLD_SECONDS
}

/** The ball leaves the keeper's hands: dropped to the ground for a kick or roll. */
export function release(sim: Sim): void {
  sim.m.ball.inHands = false
  sim.c.Air.z[sim.ball] = 0
}

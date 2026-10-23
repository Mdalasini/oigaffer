// Dribbling: how a carrier runs with the ball. Close, short touches when a
// defender is in front; long touches at full speed into open grass; knocking
// it past a defender and racing onto it; cutting past one who is close; or
// turning the body to shield it from someone close.

import { touch } from './actions'
import { DT, FOOT_REACH, TICK_RATE } from './constants'
import { emit } from './events'
import { arrivalSample, dist2, interceptRisk, nearestOpponent } from './evaluate'
import { atan2, clamp, cos, sin } from './fmath'
import { IntentKind, setIntent } from './intents'
import { createFlight, FLIGHT_STRIDE, simulateFlight } from './kicks'
import { topSpeed } from './movement'
import { launch, PassType, type PassPlan } from './passing'
import type { Belief } from './perception'
import { HALF_LENGTH, HALF_WIDTH } from './pitch'
import { chance, gauss } from './rng'
import { teamOf, type Sim } from './sim'
import { Phase } from './state'

export const DribbleMode = {
  Normal: 0,
  /** Facing up a defender: short, controlled touches. */
  FaceUp: 1,
  /** Open space: long touches at nearly full speed. */
  Sprint: 2,
  /** Body between the ball and a close opponent. */
  Shield: 3,
  /** Cutting past a close defender. */
  TakeOn: 4,
} as const
export type DribbleMode = (typeof DribbleMode)[keyof typeof DribbleMode]
export const DRIBBLE_NAMES = ['normal', 'face-up', 'sprint', 'shield', 'take-on'] as const

interface Style {
  /** Fraction of top speed. */
  speed: number
  /** How far ahead of the player's own speed each touch sends the ball (m/s). */
  push: number
  /** Seconds between touches. */
  interval: number
  /** Spread of touch direction for a poor dribbler (radians). */
  spread: number
  /** How far beyond the ball the carrier steers (m). */
  lead: number
}

const STYLES: Record<DribbleMode, Style> = {
  [DribbleMode.Normal]: { speed: 0.75, push: 2.2, interval: 0.3, spread: 0.18, lead: 3 },
  [DribbleMode.FaceUp]: { speed: 0.5, push: 1.0, interval: 0.2, spread: 0.08, lead: 1 },
  [DribbleMode.Sprint]: { speed: 0.92, push: 3.6, interval: 0.4, spread: 0.25, lead: 6 },
  [DribbleMode.Shield]: { speed: 0.18, push: 0.4, interval: 0.25, spread: 0.05, lead: 0 },
  [DribbleMode.TakeOn]: { speed: 0.85, push: 2.4, interval: 0.25, spread: 0.1, lead: 3 },
}

const opp: Belief = { x: 0, y: 0, vx: 0, vy: 0 }
/** Ticks between a carrier's considered decisions to take a man on. */
const TAKE_ON_COOLDOWN = Math.round(1.5 * TICK_RATE)
/** How long a carrier who has made up their mind to take a man on waits for the moment to do it. */
const TAKE_ON_KEEN = Math.round(1 * TICK_RATE)
/** Closer than this a defender is beaten with a cut rather than by knocking the ball past them. */
const CUT_RANGE = 3.5
const CUT_ANGLE = 0.9
const CUT_LENGTH = 6
/** How long a carrier sees a cut through before thinking again. */
export const TAKE_ON_SECONDS = 0.6
/** How long a beaten defender is wrong-footed. */
const WRONG_FOOTED_SECONDS = 0.5
const flight = createFlight()

export interface DribbleChoice {
  mode: DribbleMode
  /** Set when the best move is to knock the ball past the defender and run onto it. */
  knockOn: PassPlan | null
  /** Set when cutting past a close defender is on: where to and who. `mode` is the fallback if it is turned down. */
  cut: { x: number; y: number; on: number } | null
}

/** Picks how to run with the ball towards (tx, ty), given who is close. */
export function chooseDribble(sim: Sim, eid: number, tx: number, ty: number, passAvailable: boolean): DribbleChoice {
  const { Pos, Attr } = sim.c
  const x = Pos.x[eid]
  const y = Pos.y[eid]
  const nearest = nearestOpponent(sim, eid, x, y, opp)
  if (nearest < 0) return { mode: DribbleMode.Sprint, knockOn: null, cut: null }
  const ox = opp.x - x
  const oy = opp.y - y
  const d = Math.sqrt(ox * ox + oy * oy)
  const cx = tx - x
  const cy = ty - y
  const cl = Math.sqrt(cx * cx + cy * cy) || 1
  // How much the opponent is in the way of the carry, -1 behind .. 1 dead ahead.
  const ahead = d > 0 ? (ox * cx + oy * cy) / (d * cl) : 0
  if (d < 1.8 && ahead < 0.3 && !passAvailable) return { mode: DribbleMode.Shield, knockOn: null, cut: null }
  // Close up, a carry that only bends round a defender still runs into them.
  const close = d > 1.2 && d < CUT_RANGE && ahead > 0.2
  const inTheWay = close || (ahead > 0.5 && d >= CUT_RANGE && d < 7)
  const { Brain } = sim.c
  // Taking a man on is a decision made now and then, not every look: better dribblers try it more.
  if (inTheWay && sim.m.tick >= Brain.takeOnReady[eid] && sim.m.tick >= Brain.takeOnKeen[eid]) {
    Brain.takeOnReady[eid] = sim.m.tick + TAKE_ON_COOLDOWN
    if (chance(sim.m.rng, 0.15 + 0.35 * Attr.dribbling[eid])) Brain.takeOnKeen[eid] = sim.m.tick + TAKE_ON_KEEN
  }
  // Having decided to, go at them as soon as there is a way past.
  if (inTheWay && sim.m.tick < Brain.takeOnKeen[eid]) {
    if (close) {
      const cut = planCut(sim, eid, ox / d, oy / d, cx, cy)
      if (cut) return { mode: DribbleMode.FaceUp, knockOn: null, cut: { ...cut, on: nearest } }
    } else {
      const knock = planKnockOn(sim, eid, cx / cl, cy / cl, d)
      if (knock && topSpeed(sim, eid) + Attr.dribbling[eid] > topSpeed(sim, nearest) + 0.3) return { mode: DribbleMode.Normal, knockOn: knock, cut: null }
    }
  }
  if (ahead > 0 && d < 6) return { mode: DribbleMode.FaceUp, knockOn: null, cut: null }
  if (d > 8 || ahead < -0.3) return { mode: DribbleMode.Sprint, knockOn: null, cut: null }
  return { mode: DribbleMode.Normal, knockOn: null, cut: null }
}

/**
 * A cut past a close defender in direction (ux, uy): bent off that line to
 * the side the carry (cx, cy) was heading, or the other way if that runs out of play.
 */
function planCut(sim: Sim, eid: number, ux: number, uy: number, cx: number, cy: number): { x: number; y: number } | null {
  const { Pos } = sim.c
  const side = ux * cy - uy * cx < 0 ? -1 : 1
  for (const s of [side, -side]) {
    // Turn the line to the defender anticlockwise (s = 1) or clockwise (s = -1).
    const a = atan2(uy, ux) + s * CUT_ANGLE
    const x = Pos.x[eid] + cos(a) * CUT_LENGTH
    const y = Pos.y[eid] + sin(a) * CUT_LENGTH
    if (Math.abs(x) < HALF_LENGTH - 1 && Math.abs(y) < HALF_WIDTH - 1) return { x, y }
  }
  return null
}

/** Chance a carrier's feint and change of direction beats the defender's footwork and reading of the game. */
export function beatChance(sim: Sim, eid: number, defender: number): number {
  const A = sim.c.Attr
  return clamp(0.35 + 0.45 * (0.6 * A.dribbling[eid] + 0.4 * A.agility[eid]) - 0.35 * (0.5 * A.positioning[defender] + 0.5 * A.agility[defender]), 0.15, 0.8)
}

/** The carrier goes for it. A beaten defender is wrong-footed for a moment; one who reads it is ready to go in. */
export function takeOn(sim: Sim, eid: number, defender: number): void {
  const { c, m } = sim
  c.Brain.takeOnKeen[eid] = 0
  const beaten = chance(m.rng, beatChance(sim, eid, defender))
  if (beaten) {
    // A standing challenge already on its way is pulled out of; a slide is past stopping.
    if (c.Intent.kind[defender] === IntentKind.Tackle && m.tick >= c.Body.lungeUntil[defender]) setIntent(sim, defender, IntentKind.Press, eid)
    c.Body.stumbleUntil[defender] = m.tick + Math.round(WRONG_FOOTED_SECONDS * TICK_RATE)
    c.Brain.tackleReady[defender] = Math.max(c.Brain.tackleReady[defender], m.tick + Math.round((WRONG_FOOTED_SECONDS + 0.3) * TICK_RATE))
  } else c.Brain.commitCheck[defender] = m.tick
  emit(sim, { type: 'take-on', by: eid, on: defender, beaten, x: c.Pos.x[sim.ball], y: c.Pos.y[sim.ball] })
}

/**
 * Knock the ball past the defender into the space beyond, angled to the
 * side they are not covering, if the carrier believes they get there first.
 */
function planKnockOn(sim: Sim, eid: number, ux: number, uy: number, d: number): PassPlan | null {
  const { Pos, Vel } = sim.c
  const bx = Pos.x[sim.ball]
  const by = Pos.y[sim.ball]
  // Go round the side of the defender away from where they stand relative to the line:
  // (uy, -ux) is the carry line's right-hand side.
  const side = (opp.x - Pos.x[eid]) * uy - (opp.y - Pos.y[eid]) * ux > 0 ? -1 : 1
  const len = d + 5
  const tx = bx + ux * len + uy * side * 2.5
  const ty = by + uy * len - ux * side * 2.5
  if (Math.abs(tx) > HALF_LENGTH - 2 || Math.abs(ty) > HALF_WIDTH - 2) return null
  const [vx, vy, vz] = launch(PassType.Through, bx, by, tx, ty)
  simulateFlight(flight, bx, by, vx, vy, vz)
  const s = arrivalSample(flight, tx, ty, 1.5, 1)
  if (s < 0 || s * FLIGHT_STRIDE * DT > 2.5) return null
  const opponents = sim.teams[1 - teamOf(sim, eid)]
  const risk = interceptRisk(sim, eid, opponents, flight, s, eid, Pos.x[eid], Pos.y[eid], Vel.x[eid], Vel.y[eid])
  if (risk > 0.2) return null
  return { type: PassType.Through, target: eid, x: tx, y: ty, score: 0, success: 1 - risk }
}

/** Carries out a dribble towards the intent's target in the given mode. */
export function dribble(sim: Sim, eid: number, mode: DribbleMode, tx: number, ty: number, top: number): void {
  const { c, m, ball } = sim
  const { Pos, Vel, Motor, Attr } = c
  const style = STYLES[mode]
  let ux = tx - Pos.x[ball]
  let uy = ty - Pos.y[ball]
  if (mode === DribbleMode.Shield && nearestOpponent(sim, eid, Pos.x[eid], Pos.y[eid], opp) >= 0) {
    // Keep the body between them and the ball: ball on the far side.
    ux = Pos.x[eid] - opp.x
    uy = Pos.y[eid] - opp.y
  }
  const ul = Math.sqrt(ux * ux + uy * uy) || 1
  ux /= ul
  uy /= ul
  // Steer at a point ahead of the ball so locomotion does not brake as if arriving.
  const lead = style.lead
  Motor.tx[eid] = Pos.x[ball] + ux * lead
  Motor.ty[eid] = Pos.y[ball] + uy * lead
  Motor.speed[eid] = mode === DribbleMode.Shield ? 1.5 : top * style.speed
  Motor.faceX[eid] = mode === DribbleMode.Shield ? Pos.x[eid] + ux : tx
  Motor.faceY[eid] = mode === DribbleMode.Shield ? Pos.y[eid] + uy : ty
  const near = Math.sqrt(dist2(sim, eid, ball)) <= FOOT_REACH
  if (!near || m.phase !== Phase.Play || m.tick - m.ball.touchTick < Math.round(style.interval * TICK_RATE)) return
  const speed = Math.sqrt(Vel.x[eid] * Vel.x[eid] + Vel.y[eid] * Vel.y[eid])
  const a = atan2(uy, ux) + gauss(m.rng) * style.spread * (1.1 - Attr.dribbling[eid])
  if (mode === DribbleMode.Shield) {
    // Roll the ball to a spot just behind the body, away from the opponent.
    const sx = Pos.x[eid] + ux * 0.45 - Pos.x[ball]
    const sy = Pos.y[eid] + uy * 0.45 - Pos.y[ball]
    return touch(sim, eid, Vel.x[eid] + sx * 2, Vel.y[eid] + sy * 2)
  }
  // The ball is played at the pace the carrier is settling to, not the pace they arrived at, or it runs away
  // from them as they slow; a cut only keeps the momentum already going the new way.
  const along = mode === DribbleMode.TakeOn ? Math.max(0, Vel.x[eid] * cos(a) + Vel.y[eid] * sin(a)) : speed
  const carried = Math.min(along, Motor.speed[eid])
  const push = carried + style.push * clamp(0.8 + gauss(m.rng) * 0.15 * (1.1 - Attr.dribbling[eid]), 0.5, 1.4)
  touch(sim, eid, cos(a) * push, sin(a) * push)
}

// Defending the man on the ball: jockeying goal side, and choosing when to
// commit to a standing tackle, a sliding tackle or a shoulder charge. Every
// challenge is resolved once, the moment the defender gets there, as won,
// missed or a foul.

import { kick, takeControl } from './actions'
import { TICK_RATE } from './constants'
import { emit } from './events'
import { clamp, cos, sin } from './fmath'
import { IntentKind, setIntent } from './intents'
import { believe, type Belief } from './perception'
import { HALF_LENGTH } from './pitch'
import { chance, gauss, next, range } from './rng'
import { attackDir, teamOf, type Sim } from './sim'

export const TackleKind = { Standing: 0, Slide: 1, Charge: 2 } as const
export type TackleKind = (typeof TackleKind)[keyof typeof TackleKind]
export const TACKLE_NAMES = ['standing', 'slide', 'charge'] as const

/** How far a defender can reach for the ball: a planted foot, or a slide along the ground. */
const STANDING_REACH = 1.0
const SLIDE_REACH = 1.7
/** Bodies must be this close for a shoulder charge. */
const CHARGE_RANGE = 0.85
/** Give up on a challenge that has not reached the ball by then. */
const COMMIT_SECONDS = 0.7
const SLIDE_SECONDS = 0.45
const SLIDE_DOWN_SECONDS = 1.1
const STUMBLE_SECONDS = 0.45
/** Gap a jockeying defender keeps from the carrier, goal side. */
const CONTAIN_GAP = 1.8

const carrierSeen: Belief = { x: 0, y: 0, vx: 0, vy: 0 }
const ballSeen: Belief = { x: 0, y: 0, vx: 0, vy: 0 }

export function isGrounded(sim: Sim, eid: number): boolean {
  return sim.m.tick < sim.c.Body.downUntil[eid] && sim.m.tick >= sim.c.Body.lungeUntil[eid]
}

export function isStumbling(sim: Sim, eid: number): boolean {
  return sim.m.tick < sim.c.Body.stumbleUntil[eid]
}

/** Unit vector from (x, y) towards the goal `team` defends. */
function towardsOwnGoal(sim: Sim, team: number, x: number, y: number): [number, number] {
  const gx = -attackDir(sim, team) * HALF_LENGTH - x
  const gy = -y
  const l = Math.sqrt(gx * gx + gy * gy) || 1
  return [gx / l, gy / l]
}

/**
 * The defender engaging the carrier decides whether to keep jockeying or to
 * commit. Patient, positionally good defenders hold off until the ball is
 * exposed; aggressive ones go in sooner.
 */
export function decideDefending(sim: Sim, d: number, carrier: number): void {
  const { c, m } = sim
  const kind = c.Intent.kind[d]
  if (kind === IntentKind.Tackle && m.tick - c.Intent.since[d] < COMMIT_SECONDS * TICK_RATE) return
  if (m.tick < c.Brain.tackleReady[d]) return setIntent(sim, d, IntentKind.Press, carrier)
  believe(sim, d, carrier, carrierSeen)
  believe(sim, d, sim.ball, ballSeen)
  const dx = c.Pos.x[d] - carrierSeen.x
  const dy = c.Pos.y[d] - carrierSeen.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  const exposed = Math.sqrt((ballSeen.x - carrierSeen.x) * (ballSeen.x - carrierSeen.x) + (ballSeen.y - carrierSeen.y) * (ballSeen.y - carrierSeen.y))
  const [gx, gy] = towardsOwnGoal(sim, teamOf(sim, d), carrierSeen.x, carrierSeen.y)
  const goalSide = dist > 0 && (dx * gx + dy * gy) / dist > 0.3
  const cs = Math.sqrt(carrierSeen.vx * carrierSeen.vx + carrierSeen.vy * carrierSeen.vy)
  const ds = Math.sqrt(c.Vel.x[d] * c.Vel.x[d] + c.Vel.y[d] * c.Vel.y[d])
  const aggression = c.Attr.aggression[d]

  // Running alongside: lean in with the shoulder.
  if (cs > 3 && ds > 3 && dist < 1.3) {
    const parallel = (carrierSeen.vx * c.Vel.x[d] + carrierSeen.vy * c.Vel.y[d]) / (cs * ds)
    if (parallel > 0.7 && chance(m.rng, 0.3 + 0.4 * aggression)) return commit(sim, d, carrier, TackleKind.Charge)
  }
  // Beaten and chasing: a last-ditch slide.
  if (!goalSide && dist < 3 && cs > ds - 0.5 && chance(m.rng, 0.15 + 0.35 * aggression)) {
    return commit(sim, d, carrier, TackleKind.Slide)
  }
  // Squared up: go in when the ball is off the carrier's foot, or out of impatience.
  if (dist < 2.4) {
    const eagerness = 0.08 + 0.25 * aggression - 0.1 * c.Attr.positioning[d] + clamp((exposed - 0.4) / 0.6, 0, 1) * 0.6
    if (chance(m.rng, clamp(eagerness, 0.02, 0.9))) return commit(sim, d, carrier, TackleKind.Standing)
  }
  setIntent(sim, d, IntentKind.Press, carrier)
}

function commit(sim: Sim, d: number, carrier: number, kind: TackleKind) {
  setIntent(sim, d, IntentKind.Tackle, carrier, 0, 0, kind)
  if (kind === TackleKind.Slide) {
    sim.c.Body.lungeUntil[d] = sim.m.tick + Math.round(SLIDE_SECONDS * TICK_RATE)
    sim.c.Body.downUntil[d] = sim.m.tick + Math.round((SLIDE_SECONDS + SLIDE_DOWN_SECONDS) * TICK_RATE)
  }
}

/** Jockey: close down fast, then hold a goal-side gap and match the carrier's movement. */
export function contain(sim: Sim, d: number, top: number): void {
  const { c } = sim
  believe(sim, d, c.Intent.target[d], carrierSeen)
  const [gx, gy] = towardsOwnGoal(sim, teamOf(sim, d), carrierSeen.x, carrierSeen.y)
  // Stand where the carrier will be in a moment, not where they were.
  const px = carrierSeen.x + carrierSeen.vx * 0.3
  const py = carrierSeen.y + carrierSeen.vy * 0.3
  const tx = px + gx * CONTAIN_GAP
  const ty = py + gy * CONTAIN_GAP
  const dx = tx - c.Pos.x[d]
  const dy = ty - c.Pos.y[d]
  const close = dx * dx + dy * dy < 3 * 3
  const cs = Math.sqrt(carrierSeen.vx * carrierSeen.vx + carrierSeen.vy * carrierSeen.vy)
  c.Motor.tx[d] = tx
  c.Motor.ty[d] = ty
  c.Motor.speed[d] = close ? Math.min(top, cs + 1.5) : top * 0.92
  c.Motor.faceX[d] = carrierSeen.x
  c.Motor.faceY[d] = carrierSeen.y
}

/** Carries out a committed challenge: get to the ball (or the man) and resolve it on arrival. */
export function challenge(sim: Sim, d: number, top: number): void {
  const { c, m, ball } = sim
  const carrier = c.Intent.target[d]
  const kind = c.Intent.mode[d] as TackleKind
  if (m.ball.owner !== carrier) return setIntent(sim, d, IntentKind.Hold)
  const bx = c.Pos.x[ball]
  const by = c.Pos.y[ball]
  if (kind === TackleKind.Charge) {
    c.Motor.tx[d] = c.Pos.x[carrier]
    c.Motor.ty[d] = c.Pos.y[carrier]
    c.Motor.speed[d] = top
  } else {
    c.Motor.tx[d] = bx + c.Vel.x[ball] * 0.15
    c.Motor.ty[d] = by + c.Vel.y[ball] * 0.15
    c.Motor.speed[d] = kind === TackleKind.Slide ? top + 2 : top
  }
  const reachBall = Math.sqrt((bx - c.Pos.x[d]) * (bx - c.Pos.x[d]) + (by - c.Pos.y[d]) * (by - c.Pos.y[d]))
  const reachMan = Math.sqrt((c.Pos.x[carrier] - c.Pos.x[d]) * (c.Pos.x[carrier] - c.Pos.x[d]) + (c.Pos.y[carrier] - c.Pos.y[d]) * (c.Pos.y[carrier] - c.Pos.y[d]))
  const arrived =
    kind === TackleKind.Charge ? reachMan < CHARGE_RANGE : reachBall < (kind === TackleKind.Slide ? SLIDE_REACH : STANDING_REACH)
  const expired = kind === TackleKind.Slide ? m.tick >= c.Body.lungeUntil[d] : m.tick - c.Intent.since[d] >= COMMIT_SECONDS * TICK_RATE
  if (arrived) resolve(sim, d, carrier, kind)
  else if (expired) {
    c.Brain.tackleReady[d] = m.tick + Math.round(0.4 * TICK_RATE)
    setIntent(sim, d, IntentKind.Press, carrier)
  }
}

function resolve(sim: Sim, d: number, carrier: number, kind: TackleKind) {
  const { c, m, ball } = sim
  const A = c.Attr
  const exposure = clamp((Math.sqrt(distSq(sim, ball, carrier)) - 0.3) / 0.7, 0, 1)
  // Coming through the back of the carrier is where fouls come from.
  const fx = cos(c.Facing.a[carrier])
  const fy = sin(c.Facing.a[carrier])
  const rx = c.Pos.x[d] - c.Pos.x[carrier]
  const ry = c.Pos.y[d] - c.Pos.y[carrier]
  const rl = Math.sqrt(rx * rx + ry * ry) || 1
  const fromBehind = (rx * fx + ry * fy) / rl < -0.4
  c.Brain.tackleReady[d] = m.tick + Math.round(1.2 * TICK_RATE)
  setIntent(sim, d, IntentKind.Press, carrier)

  let win: number
  let foul: number
  if (kind === TackleKind.Charge) {
    win = clamp(0.5 + (A.strength[d] - A.strength[carrier]) * 0.9, 0.1, 0.9)
    foul = fromBehind ? 0.6 : 0.04 + 0.06 * A.aggression[d]
  } else {
    const skill = A.tackling[d] - 0.6 * A.dribbling[carrier]
    win = clamp(0.35 + 0.5 * skill + 0.3 * exposure, 0.05, 0.9) * (kind === TackleKind.Slide ? 0.8 : 1)
    foul = 0.04 + (fromBehind ? 0.35 : 0) + (kind === TackleKind.Slide ? 0.12 : 0) + 0.1 * A.aggression[d] - 0.08 * A.tackling[d]
  }
  const roll = next(m.rng)
  // A careless or reckless challenge is a foul whether or not it gets the ball.
  const reckless = kind === TackleKind.Slide && fromBehind
  if (roll < clamp(foul, 0.01, 0.8)) {
    stumble(sim, carrier)
    c.Vel.x[carrier] *= 0.3
    c.Vel.y[carrier] *= 0.3
    m.ball.owner = -1
    return emit(sim, { type: 'tackle', by: d, on: carrier, kind: TACKLE_NAMES[kind], outcome: 'foul', reckless, fromBehind, x: c.Pos.x[ball], y: c.Pos.y[ball] })
  }
  if (next(m.rng) < win) {
    emit(sim, { type: 'tackle', by: d, on: carrier, kind: TACKLE_NAMES[kind], outcome: 'won', reckless: false, fromBehind, x: c.Pos.x[ball], y: c.Pos.y[ball] })
    if (kind === TackleKind.Charge) {
      // Knocked off the ball: the carrier staggers and the ball runs on.
      stumble(sim, carrier)
      c.Vel.x[carrier] *= 0.5
      c.Vel.y[carrier] *= 0.5
      m.ball.owner = -1
      return
    }
    if (kind === TackleKind.Standing && chance(m.rng, 0.35 + 0.3 * A.tackling[d])) return takeControl(sim, d, true)
    // The ball is poked or slid away from the carrier, roughly the way the defender is facing.
    const a = c.Facing.a[d] + gauss(m.rng) * 0.6
    const speed = kind === TackleKind.Slide ? range(m.rng, 6, 11) : range(m.rng, 3, 6)
    return kick(sim, d, cos(a) * speed, sin(a) * speed, 0, 'tackle')
  }
  emit(sim, { type: 'tackle', by: d, on: carrier, kind: TACKLE_NAMES[kind], outcome: 'missed', reckless: false, fromBehind, x: c.Pos.x[ball], y: c.Pos.y[ball] })
  if (kind === TackleKind.Standing || kind === TackleKind.Charge) stumble(sim, d)
  // The beaten defender has turned the wrong way.
  c.Brain.noTouchUntil[d] = m.tick + Math.round(0.6 * TICK_RATE)
}

function distSq(sim: Sim, a: number, b: number): number {
  const { Pos } = sim.c
  const dx = Pos.x[a] - Pos.x[b]
  const dy = Pos.y[a] - Pos.y[b]
  return dx * dx + dy * dy
}

function stumble(sim: Sim, eid: number) {
  sim.c.Body.stumbleUntil[eid] = sim.m.tick + Math.round(STUMBLE_SECONDS * TICK_RATE)
}

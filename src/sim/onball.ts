// Decisions with the ball, or about to get it: shoot, pass, carry, or play
// it first time, the give-and-go that can follow a pass, and a keeper
// getting the ball out of their hands.

import { TICK_RATE } from './constants'
import { lossValue, pitchValue, pressureAt } from './evaluate'
import { atan2, clamp, cos, sin } from './fmath'
import { IntentKind, setIntent } from './intents'
import { intercept, type Intercept } from './movement'
import { bestPass, PassType, type PassPlan } from './passing'
import { believe, call, HEARING_RADIUS, type Belief } from './perception'
import { heldFor, mustRelease } from './keeper'
import { HALF_LENGTH, HALF_WIDTH } from './pitch'
import { estimateXg, planShot, type ShotPlan } from './shooting'
import { chooseDribble } from './dribble'
import { chance } from './rng'
import { attackDir, roleOf, teamOf, type Sim } from './sim'

/** A player keeps a freshly controlled ball at least this long unless pressed. */
const MIN_HOLD = Math.round(0.3 * TICK_RATE)
/** First-time passes are only considered once the ball is this close (seconds). */
const FIRST_TIME_WINDOW = 0.6
const CARRY_DISTANCE = 8
const CARRY_ANGLES = [0, 0.5, -0.5, 1, -1]
const SHOT_BIAS = 1.15
const FIRST_TIME_SHOT = 0.85

const ic: Intercept = { t: 0, x: 0, y: 0 }
const seen: Belief = { x: 0, y: 0, vx: 0, vy: 0 }

export function setPlan(sim: Sim, eid: number, plan: PassPlan | null, firstTime = false): void {
  const { Plan } = sim.c
  Plan.type[eid] = plan ? plan.type : -1
  Plan.target[eid] = plan ? plan.target : -1
  Plan.x[eid] = plan ? plan.x : 0
  Plan.y[eid] = plan ? plan.y : 0
  Plan.firstTime[eid] = firstTime ? 1 : 0
}

/** Plan type marking a shot rather than a pass. */
export const SHOT_PLAN = 99

export function setShotPlan(sim: Sim, eid: number, shot: ShotPlan, firstTime = false): void {
  const { Plan } = sim.c
  Plan.type[eid] = SHOT_PLAN
  Plan.target[eid] = -1
  Plan.x[eid] = shot.x
  Plan.y[eid] = shot.y
  Plan.z[eid] = shot.z
  Plan.firstTime[eid] = firstTime ? 1 : 0
}

export function shotPlanOf(sim: Sim, eid: number): ShotPlan | null {
  const { Plan } = sim.c
  if (Plan.type[eid] !== SHOT_PLAN) return null
  return { x: Plan.x[eid], y: Plan.y[eid], z: Plan.z[eid], xg: 0 }
}

export function planOf(sim: Sim, eid: number): PassPlan | null {
  const { Plan } = sim.c
  if (Plan.type[eid] < 0 || Plan.type[eid] === SHOT_PLAN) return null
  return { type: Plan.type[eid] as PassType, target: Plan.target[eid], x: Plan.x[eid], y: Plan.y[eid], score: 0, success: 1 }
}

export function decideOnBall(sim: Sim, eid: number): void {
  const { c, m, ball } = sim
  const kind = c.Intent.kind[eid]
  if ((kind === IntentKind.Pass || kind === IntentKind.Shoot) && c.Plan.type[eid] >= 0) return
  if (m.ball.inHands) return decideInHands(sim, eid)
  const bx = c.Pos.x[ball]
  const by = c.Pos.y[ball]
  const pressure = pressureAt(sim, eid, bx, by)
  const held = m.tick - c.Brain.gotBall[eid]
  const carry = bestCarry(sim, eid, pressure)
  const pass = bestPass(sim, eid, bx, by)
  const pressed = pressure < 2.5
  const xg = estimateXg(sim, eid, bx, by)
  // Players shoot a little more readily than the numbers say.
  if (xg > 0.03 && xg * SHOT_BIAS >= Math.max(carry.score, pass ? pass.score : -1)) {
    setShotPlan(sim, eid, planShot(sim, eid, bx, by))
    return setIntent(sim, eid, IntentKind.Shoot)
  }
  if (pass && (held >= MIN_HOLD || pressed) && (pass.score > carry.score + 0.004 || (pressed && pass.success > 0.5))) {
    setPlan(sim, eid, pass)
    return setIntent(sim, eid, IntentKind.Pass, pass.target, pass.x, pass.y)
  }
  const style = chooseDribble(sim, eid, carry.x, carry.y, pass !== null && pass.success > 0.6)
  if (style.knockOn) {
    setPlan(sim, eid, style.knockOn)
    return setIntent(sim, eid, IntentKind.Pass, eid, style.knockOn.x, style.knockOn.y)
  }
  setPlan(sim, eid, null)
  setIntent(sim, eid, IntentKind.Carry, -1, carry.x, carry.y, style.mode)
}

/** Where to run with the ball: forwards, bending away from opponents in the way. */
function bestCarry(sim: Sim, eid: number, pressure: number): { x: number; y: number; score: number } {
  const { c } = sim
  const team = teamOf(sim, eid)
  const dir = attackDir(sim, team)
  const x = c.Pos.x[eid]
  const y = c.Pos.y[eid]
  const toGoal = atan2(-y, dir * HALF_LENGTH - x)
  let best = { x, y, score: -Infinity }
  for (const turn of CARRY_ANGLES) {
    const a = toGoal + turn
    const tx = clamp(x + cos(a) * CARRY_DISTANCE, -HALF_LENGTH + 1, HALF_LENGTH - 1)
    const ty = clamp(y + sin(a) * CARRY_DISTANCE, -HALF_WIDTH + 1, HALF_WIDTH - 1)
    const room = pressureAt(sim, eid, (x + tx) / 2, (y + ty) / 2)
    const risk = clamp((4 - room) / 4, 0, 1) * 0.6 + clamp((3 - pressure) / 3, 0, 1) * 0.3
    const score = (1 - risk) * pitchValue(sim, team, tx, ty) - risk * lossValue(sim, team, tx, ty) - Math.abs(turn) * 0.002
    if (score > best.score) best = { x: tx, y: ty, score }
  }
  return best
}

/** A receiver about to get the ball decides whether to play it first time: a finish or a pass. */
export function decideFirstTime(sim: Sim, eid: number): void {
  const { c, m } = sim
  intercept(sim, eid, ic)
  if (ic.t > FIRST_TIME_WINDOW) return
  const wall = m.tick < c.Brain.wallUntil[eid] ? c.Brain.wallFor[eid] : -1
  const pressure = pressureAt(sim, eid, ic.x, ic.y)
  // In front of goal a first-time finish beats taking a touch.
  const xg = estimateXg(sim, eid, ic.x, ic.y) * FIRST_TIME_SHOT
  if (wall < 0 && pressure > 3) {
    if (xg > 0.08) return setShotPlan(sim, eid, planShot(sim, eid, ic.x, ic.y), true)
    return setPlan(sim, eid, null)
  }
  // Volleying a long ball first time is rare; first-time passes stay on the ground.
  const plan = bestPass(sim, eid, ic.x, ic.y, wall, true)
  if (xg > 0.05 && xg >= (plan ? plan.score : 0)) setShotPlan(sim, eid, planShot(sim, eid, ic.x, ic.y), true)
  else if (plan && plan.success > 0.65 && plan.score > 0.005) setPlan(sim, eid, plan, true)
  else setPlan(sim, eid, null)
}

/**
 * A keeper with the ball in their hands waits for the team to spread out,
 * then rolls, throws or kicks it to the best option, or launches it long
 * if nothing is on before they must let go.
 */
function decideInHands(sim: Sim, gk: number): void {
  const { c, ball } = sim
  if (heldFor(sim, gk) < 1.5) return setIntent(sim, gk, IntentKind.Wait)
  const pass = bestPass(sim, gk, c.Pos.x[ball], c.Pos.y[ball])
  if (pass && (pass.success > 0.7 || mustRelease(sim, gk))) {
    setPlan(sim, gk, pass)
    return setIntent(sim, gk, IntentKind.Pass, pass.target, pass.x, pass.y)
  }
  if (!mustRelease(sim, gk)) return setIntent(sim, gk, IntentKind.Wait)
  const dir = attackDir(sim, teamOf(sim, gk))
  const long: PassPlan = { type: PassType.Lofted, target: -1, x: c.Pos.x[gk] + dir * 50, y: 0, score: 0, success: 0 }
  setPlan(sim, gk, long)
  setIntent(sim, gk, IntentKind.Pass, -1, long.x, long.y)
}

/**
 * After a pass, an attacking player may set off to get it back: they call
 * for the return and run into space beyond.
 */
export function maybeGiveAndGo(sim: Sim, passer: number, plan: PassPlan): void {
  const { c, m } = sim
  if (plan.type !== PassType.Ground && plan.type !== PassType.Through) return
  const role = roleOf(sim, passer)
  if (role === 'GK' || role === 'CB') return
  const team = teamOf(sim, passer)
  const dir = attackDir(sim, team)
  const x = c.Pos.x[passer]
  const y = c.Pos.y[passer]
  if (x * dir < -10) return
  const rx = clamp(x + dir * 12, -HALF_LENGTH + 2, HALF_LENGTH - 2)
  const ry = clamp(y * 0.8, -HALF_WIDTH + 2, HALF_WIDTH - 2)
  if (pressureAt(sim, passer, rx, ry) < 4) return
  believe(sim, passer, plan.target, seen)
  if ((seen.x - x) * (seen.x - x) + (seen.y - y) * (seen.y - y) > HEARING_RADIUS * HEARING_RADIUS) return
  if (!chance(m.rng, 0.2 + 0.35 * c.Attr.vision[passer])) return
  call(sim, passer, 'give-and-go', plan.target, passer)
  c.Brain.wallFor[plan.target] = passer
  c.Brain.wallUntil[plan.target] = m.tick + Math.round(2.5 * TICK_RATE)
  setIntent(sim, passer, IntentKind.Run, -1, rx, ry)
}

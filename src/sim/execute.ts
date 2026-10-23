// Carries out each player's intent every tick: sets their motor and plays the
// ball when the intent calls for it.

import { touch } from './actions'
import { FOOT_REACH, TICK_RATE } from './constants'
import { dist2, pressureAt } from './evaluate'
import { IntentKind, setIntent } from './intents'
import { intercept, topSpeed, type Intercept } from './movement'
import { maybeGiveAndGo, planOf, setPlan } from './onball'
import { canStrike, strikePass } from './passing'
import { believe, type Belief } from './perception'
import { CENTRE_CIRCLE_RADIUS, HALF_LENGTH } from './pitch'
import { kickOffTarget, shapeTarget, type Point } from './shape'
import { attackDir, teamOf, type Sim } from './sim'
import { Phase } from './state'

const TOUCH_INTERVAL = Math.round(0.3 * TICK_RATE)

const ic: Intercept = { t: 0, x: 0, y: 0 }
const pt: Point = { x: 0, y: 0 }
const seen: Belief = { x: 0, y: 0, vx: 0, vy: 0 }

export function intentSystem(sim: Sim): void {
  const { c, ball } = sim
  const { Intent, Motor, Pos } = c
  for (const eid of sim.players) {
    const top = topSpeed(sim, eid)
    // Players watch the ball where they believe it is.
    believe(sim, eid, ball, seen)
    Motor.hasFace[eid] = 1
    Motor.faceX[eid] = seen.x
    Motor.faceY[eid] = seen.y
    switch (Intent.kind[eid]) {
      case IntentKind.Hold:
        holdTarget(sim, eid, pt)
        moveTo(sim, eid, pt.x, pt.y, holdSpeed(sim, eid, pt, top))
        break
      case IntentKind.Chase:
        intercept(sim, eid, ic)
        moveTo(sim, eid, ic.x, ic.y, top)
        break
      case IntentKind.Receive:
        receive(sim, eid, top)
        break
      case IntentKind.Press:
        press(sim, eid, top)
        break
      case IntentKind.Carry:
        carry(sim, eid, top)
        break
      case IntentKind.Pass:
        pass(sim, eid, top)
        break
      case IntentKind.TakeRestart: {
        // Approach from the side away from the pitch centre so the ball is struck into play.
        const bx = Pos.x[ball]
        const by = Pos.y[ball]
        const l = Math.sqrt(bx * bx + by * by) || 1
        moveTo(sim, eid, bx + (bx / l) * 0.5, by + (by / l) * 0.5, top * 0.7)
        break
      }
      case IntentKind.Wait:
        moveTo(sim, eid, Pos.x[eid], Pos.y[eid], 0)
        break
      case IntentKind.Run:
        moveTo(sim, eid, Intent.x[eid], Intent.y[eid], top * 0.95)
        break
    }
  }
}

function moveTo(sim: Sim, eid: number, x: number, y: number, speed: number) {
  const { Motor } = sim.c
  Motor.tx[eid] = x
  Motor.ty[eid] = y
  Motor.speed[eid] = speed
}

function holdSpeed(sim: Sim, eid: number, target: Point, top: number): number {
  const { Pos } = sim.c
  const dx = target.x - Pos.x[eid]
  const dy = target.y - Pos.y[eid]
  const d = Math.sqrt(dx * dx + dy * dy)
  return d > 10 ? top * 0.8 : d > 4 ? top * 0.55 : 2.5
}

function holdTarget(sim: Sim, eid: number, out: Point): Point {
  const { m, c, ball } = sim
  if (m.phase === Phase.KickOff || m.phase === Phase.Goal || m.phase === Phase.HalfTime) {
    return kickOffTarget(sim, eid, teamOf(sim, eid) === m.restart.team, out)
  }
  shapeTarget(sim, eid, out)
  if (m.phase === Phase.Restart && teamOf(sim, eid) !== m.restart.team) {
    // Opponents give the taker the required distance.
    const dx = out.x - c.Pos.x[ball]
    const dy = out.y - c.Pos.y[ball]
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d < CENTRE_CIRCLE_RADIUS) {
      const k = d > 0 ? CENTRE_CIRCLE_RADIUS / d : 0
      out.x = c.Pos.x[ball] + (d > 0 ? dx * k : -attackDir(sim, teamOf(sim, eid)) * CENTRE_CIRCLE_RADIUS)
      out.y = c.Pos.y[ball] + dy * k
    }
  }
  return out
}

function receive(sim: Sim, eid: number, top: number) {
  const { m, c } = sim
  intercept(sim, eid, ic)
  moveTo(sim, eid, ic.x, ic.y, top)
  const plan = planOf(sim, eid)
  if (!plan || !c.Plan.firstTime[eid] || m.phase !== Phase.Play) return
  if (m.ball.owner >= 0 || m.tick < c.Brain.noTouchUntil[eid] || !canStrike(sim, eid)) return
  setPlan(sim, eid, null)
  setIntent(sim, eid, IntentKind.Hold)
  strikePass(sim, eid, plan, { firstTime: true, pressure: pressureAt(sim, eid, c.Pos.x[sim.ball], c.Pos.y[sim.ball]) })
  maybeGiveAndGo(sim, eid, plan)
}

function press(sim: Sim, eid: number, top: number) {
  const { Intent, Pos } = sim.c
  // Get goal side of where the carrier is believed to be.
  believe(sim, eid, Intent.target[eid], seen)
  const goalX = -attackDir(sim, teamOf(sim, eid)) * HALF_LENGTH
  const gx = goalX - seen.x
  const gy = -seen.y
  const gl = Math.sqrt(gx * gx + gy * gy) || 1
  const tx = seen.x + (gx / gl) * 1.8
  const ty = seen.y + (gy / gl) * 1.8
  const dx = seen.x - Pos.x[eid]
  const dy = seen.y - Pos.y[eid]
  moveTo(sim, eid, tx, ty, dx * dx + dy * dy < 3.5 * 3.5 ? 2.5 : top * 0.9)
}

function pass(sim: Sim, eid: number, top: number) {
  const { m, c, ball } = sim
  const plan = planOf(sim, eid)
  if (m.ball.owner !== eid || !plan) {
    setPlan(sim, eid, null)
    return setIntent(sim, eid, IntentKind.Hold)
  }
  moveTo(sim, eid, c.Pos.x[ball], c.Pos.y[ball], top * 0.6)
  c.Motor.faceX[eid] = plan.x
  c.Motor.faceY[eid] = plan.y
  if (m.phase !== Phase.Play || !canStrike(sim, eid)) return
  setPlan(sim, eid, null)
  setIntent(sim, eid, IntentKind.Hold)
  strikePass(sim, eid, plan, { firstTime: false, pressure: pressureAt(sim, eid, c.Pos.x[ball], c.Pos.y[ball]) })
  maybeGiveAndGo(sim, eid, plan)
}

function carry(sim: Sim, eid: number, top: number) {
  const { c, m, ball } = sim
  const { Pos, Vel, Intent } = c
  if (m.ball.owner !== eid) return setIntent(sim, eid, IntentKind.Hold)
  const dx = Intent.x[eid] - Pos.x[ball]
  const dy = Intent.y[eid] - Pos.y[ball]
  const dl = Math.sqrt(dx * dx + dy * dy) || 1
  const ux = dx / dl
  const uy = dy / dl
  // Run onto the ball, slightly beyond it along the carry line.
  moveTo(sim, eid, Pos.x[ball] + ux * 0.6, Pos.y[ball] + uy * 0.6, top * 0.75)
  c.Motor.faceX[eid] = Intent.x[eid]
  c.Motor.faceY[eid] = Intent.y[eid]
  const near = Math.sqrt(dist2(sim, eid, ball)) <= FOOT_REACH
  if (near && m.phase === Phase.Play && m.tick - m.ball.touchTick >= TOUCH_INTERVAL) {
    const speed = Math.sqrt(Vel.x[eid] * Vel.x[eid] + Vel.y[eid] * Vel.y[eid])
    const push = speed + 2.2
    touch(sim, eid, ux * push, uy * push)
  }
}

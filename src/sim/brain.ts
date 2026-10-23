// Player decision making (staggered, a few times a second) and intent
// execution (every tick).

import { touch } from './actions'
import { FOOT_REACH, TICK_RATE } from './constants'
import { CENTRE_CIRCLE_RADIUS, HALF_LENGTH, PENALTY_AREA_DEPTH, PENALTY_AREA_WIDTH } from './pitch'
import { clamp } from './fmath'
import { IntentKind, setIntent } from './intents'
import { intercept, topSpeed, type Intercept } from './movement'
import { bestGroundPass, strikeGroundPass } from './passing'
import { readBall } from './systems/ball'
import { predictPath } from './scratch'
import { kickOffTarget, shapeTarget, type Point } from './shape'
import { attackDir, roleOf, teamOf, type Sim } from './sim'
import { next } from './rng'
import { Phase } from './state'
import type { BallState } from './ballmotion'

const THINK_ON_BALL = 3
const THINK_OFF_BALL = 6
const MIN_HOLD = Math.round(0.3 * TICK_RATE)
const TOUCH_INTERVAL = Math.round(0.3 * TICK_RATE)

const bs: BallState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
const ic: Intercept = { t: 0, x: 0, y: 0 }
const pt: Point = { x: 0, y: 0 }

/** Shared per-tick facts every brain reads: the ball's path and who goes to it. */
export function updateScratch(sim: Sim): void {
  const { scratch, m, c } = sim
  predictPath(scratch.path, readBall(sim, bs))
  for (const team of [0, 1]) {
    scratch.chaser[team] = -1
    scratch.presser[team] = -1
    if (m.phase !== Phase.Play) continue
    if (m.ball.owner < 0) {
      let best = -1
      let bestT = Infinity
      for (const eid of sim.teams[team]) {
        if (c.Intent.kind[eid] === IntentKind.Receive) {
          best = eid
          break
        }
        intercept(sim, eid, ic)
        if (roleOf(sim, eid) === 'GK' && !inOwnBox(sim, team, ic.x, ic.y)) continue
        if (ic.t < bestT) {
          best = eid
          bestT = ic.t
        }
      }
      scratch.chaser[team] = best
    } else if (teamOf(sim, m.ball.owner) !== team) {
      let best = -1
      let bestD = Infinity
      for (const eid of sim.teams[team]) {
        if (roleOf(sim, eid) === 'GK') continue
        const d = dist2(sim, eid, sim.ball)
        if (d < bestD) {
          best = eid
          bestD = d
        }
      }
      scratch.presser[team] = best
    }
  }
}

function inOwnBox(sim: Sim, team: number, x: number, y: number): boolean {
  const ax = x * attackDir(sim, team)
  return ax < -HALF_LENGTH + PENALTY_AREA_DEPTH && Math.abs(y) < PENALTY_AREA_WIDTH / 2
}

function dist2(sim: Sim, a: number, b: number): number {
  const { Pos } = sim.c
  const dx = Pos.x[a] - Pos.x[b]
  const dy = Pos.y[a] - Pos.y[b]
  return dx * dx + dy * dy
}

export function thinkSystem(sim: Sim): void {
  const { Brain } = sim.c
  for (const eid of sim.players) {
    if (sim.m.tick < Brain.nextThink[eid]) continue
    Brain.nextThink[eid] = sim.m.tick + (sim.m.ball.owner === eid ? THINK_ON_BALL : THINK_OFF_BALL)
    decide(sim, eid)
  }
}

function decide(sim: Sim, eid: number): void {
  const { m, c, scratch } = sim
  const team = teamOf(sim, eid)
  if (m.phase !== Phase.Play) {
    if (eid !== m.restart.taker || m.phase === Phase.Goal || m.phase === Phase.HalfTime) setIntent(sim, eid, IntentKind.Hold)
    return
  }
  const owner = m.ball.owner
  const kind = c.Intent.kind[eid]
  if (owner === eid) return decideOnBall(sim, eid)
  if (owner < 0) {
    if (kind === IntentKind.Receive && m.ball.lastTeam === team) return
    if (scratch.chaser[team] === eid) return setIntent(sim, eid, IntentKind.Chase)
    return setIntent(sim, eid, IntentKind.Hold)
  }
  if (teamOf(sim, owner) !== team && scratch.presser[team] === eid) return setIntent(sim, eid, IntentKind.Press, owner)
  setIntent(sim, eid, IntentKind.Hold)
}

function decideOnBall(sim: Sim, eid: number): void {
  const { c, m } = sim
  const team = teamOf(sim, eid)
  const dir = attackDir(sim, team)
  const x = c.Pos.x[eid]
  const y = c.Pos.y[eid]
  if (c.Intent.kind[eid] === IntentKind.Pass) return

  let pressure = Infinity
  for (const o of sim.teams[1 - team]) pressure = Math.min(pressure, Math.sqrt(dist2(sim, eid, o)))
  const held = m.tick - m.ball.touchTick
  const pass = bestGroundPass(sim, eid)
  const wantsPass = pass && (pressure < 4 || pass.score > 0.25 + next(m.rng) * 0.3)
  if (wantsPass && (held >= MIN_HOLD || pressure < 2)) {
    return setIntent(sim, eid, IntentKind.Pass, pass.target, pass.x, pass.y)
  }
  const tx = x + dir * 10
  const ty = clamp(y * 0.8, -20, 20)
  setIntent(sim, eid, IntentKind.Carry, -1, tx, ty)
}

/** Turns each player's intent into a motor command, and plays the ball when the intent calls for it. */
export function intentSystem(sim: Sim): void {
  const { c, m, ball } = sim
  const { Intent, Motor, Pos } = c
  for (const eid of sim.players) {
    const top = topSpeed(sim, eid)
    Motor.hasFace[eid] = 1
    Motor.faceX[eid] = Pos.x[ball]
    Motor.faceY[eid] = Pos.y[ball]
    switch (Intent.kind[eid]) {
      case IntentKind.Hold:
        holdTarget(sim, eid, pt)
        moveTo(sim, eid, pt.x, pt.y, holdSpeed(sim, eid, pt, top))
        break
      case IntentKind.Chase:
      case IntentKind.Receive:
        intercept(sim, eid, ic)
        moveTo(sim, eid, ic.x, ic.y, top)
        break
      case IntentKind.Press: {
        const carrier = Intent.target[eid]
        const goalX = -attackDir(sim, teamOf(sim, eid)) * HALF_LENGTH
        const gx = goalX - Pos.x[carrier]
        const gy = -Pos.y[carrier]
        const gl = Math.sqrt(gx * gx + gy * gy) || 1
        const tx = Pos.x[carrier] + (gx / gl) * 1.8
        const ty = Pos.y[carrier] + (gy / gl) * 1.8
        const close = Math.sqrt(dist2(sim, eid, carrier)) < 3.5
        moveTo(sim, eid, tx, ty, close ? 2.5 : top * 0.9)
        break
      }
      case IntentKind.Carry:
        carry(sim, eid, top)
        break
      case IntentKind.Pass:
        moveTo(sim, eid, Pos.x[ball], Pos.y[ball], top * 0.6)
        if (m.ball.owner === eid && Math.sqrt(dist2(sim, eid, ball)) <= FOOT_REACH) {
          strikeGroundPass(sim, eid, Intent.target[eid], Intent.x[eid], Intent.y[eid])
          setIntent(sim, eid, IntentKind.Hold)
        } else if (m.ball.owner !== eid) {
          setIntent(sim, eid, IntentKind.Hold)
        }
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
  if (near && m.tick - m.ball.touchTick >= TOUCH_INTERVAL) {
    const speed = Math.sqrt(Vel.x[eid] * Vel.x[eid] + Vel.y[eid] * Vel.y[eid])
    const push = speed + 2.2
    touch(sim, eid, ux * push, uy * push)
  }
}

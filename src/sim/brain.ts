// Player decision making: staggered, a few times a second per player. Each
// decision sets an intent (see intents.ts) that execute.ts carries out every
// tick. On-ball choices live in onball.ts.

import type { BallState } from './ballmotion'
import { CONTROL_HEIGHT, TICK_RATE } from './constants'
import { IntentKind, setIntent } from './intents'
import { isDiving, isDown, KEEPER_HEIGHT, shouldRush } from './keeper'
import { intercept, type Intercept } from './movement'
import { believe, call, HEARING_RADIUS, type Belief } from './perception'
import { decideDefending } from './defending'
import { decideFirstTime, decideOnBall } from './onball'
import { HALF_LENGTH, PENALTY_AREA_DEPTH, PENALTY_AREA_WIDTH } from './pitch'
import { predictPath } from './scratch'
import { attackDir, roleOf, teamOf, type Sim } from './sim'
import { Phase } from './state'
import { readBall } from './systems/ball'

const THINK_ON_BALL = 3
const THINK_OFF_BALL = 6
/** Longest a run is kept up without a fresh reason. */
const RUN_LIMIT = 3 * TICK_RATE

const bs: BallState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
const ic: Intercept = { t: 0, x: 0, y: 0 }
const seen: Belief = { x: 0, y: 0, vx: 0, vy: 0 }

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
        // Keepers come for anything they can take with their hands in their own box.
        const keeper = roleOf(sim, eid) === 'GK'
        // Defenders who read the game move for an opponent's pass sooner.
        const reaction = m.ball.lastTeam === team ? 0.2 : 0.35 - 0.2 * c.Attr.positioning[eid]
        intercept(sim, eid, ic, reaction, keeper ? KEEPER_HEIGHT : undefined)
        if (keeper && !inOwnBox(sim, team, ic.x, ic.y)) continue
        if (ic.t < bestT) {
          best = eid
          bestT = ic.t
        }
      }
      scratch.chaser[team] = best
      // A keeper coming for a high ball shouts so defenders leave it.
      if (best >= 0 && roleOf(sim, best) === 'GK' && c.Air.z[sim.ball] > CONTROL_HEIGHT && m.tick >= c.Brain.nextCall[best]) {
        const mate = nearestTeammate(sim, best)
        if (mate >= 0) call(sim, best, 'keeper', mate, -1)
      }
    } else if (teamOf(sim, m.ball.owner) !== team && !m.ball.inHands) {
      let best = -1
      let bestD = Infinity
      for (const eid of sim.teams[team]) {
        if (roleOf(sim, eid) === 'GK') continue
        believe(sim, eid, sim.ball, seen)
        const dx = seen.x - c.Pos.x[eid]
        const dy = seen.y - c.Pos.y[eid]
        const d = dx * dx + dy * dy
        if (d < bestD) {
          best = eid
          bestD = d
        }
      }
      scratch.presser[team] = best
    }
  }
}

function nearestTeammate(sim: Sim, eid: number): number {
  const { Pos } = sim.c
  let best = -1
  let bestD = HEARING_RADIUS * HEARING_RADIUS
  for (const t of sim.teams[teamOf(sim, eid)]) {
    if (t === eid) continue
    const d = (Pos.x[t] - Pos.x[eid]) * (Pos.x[t] - Pos.x[eid]) + (Pos.y[t] - Pos.y[eid]) * (Pos.y[t] - Pos.y[eid])
    if (d < bestD) {
      best = t
      bestD = d
    }
  }
  return best
}

function inOwnBox(sim: Sim, team: number, x: number, y: number): boolean {
  const ax = x * attackDir(sim, team)
  return ax < -HALF_LENGTH + PENALTY_AREA_DEPTH && Math.abs(y) < PENALTY_AREA_WIDTH / 2
}

export function thinkSystem(sim: Sim): void {
  const { Brain } = sim.c
  for (const eid of sim.players) {
    if (sim.m.tick < Brain.nextThink[eid]) continue
    const kind = sim.c.Intent.kind[eid]
    const urgent = sim.m.ball.owner === eid || kind === IntentKind.Receive || kind === IntentKind.Press || kind === IntentKind.Tackle
    Brain.nextThink[eid] = sim.m.tick + (urgent ? THINK_ON_BALL : THINK_OFF_BALL)
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
  if (kind === IntentKind.Dive && (isDiving(sim, eid) || isDown(sim, eid))) return
  if (kind === IntentKind.Run && owner < 0 && m.tick - c.Intent.since[eid] < RUN_LIMIT) return
  if (kind === IntentKind.Run && owner >= 0 && teamOf(sim, owner) === team && m.tick - c.Intent.since[eid] < RUN_LIMIT) return
  if (owner < 0) {
    if (kind === IntentKind.Receive && m.ball.lastTeam === team) return decideFirstTime(sim, eid)
    if (scratch.chaser[team] === eid) return setIntent(sim, eid, IntentKind.Chase)
    return setIntent(sim, eid, IntentKind.Hold)
  }
  if (teamOf(sim, owner) !== team && scratch.presser[team] === eid) return decideDefending(sim, eid, owner)
  if (teamOf(sim, owner) !== team && roleOf(sim, eid) === 'GK' && shouldRush(sim, eid, owner)) {
    return setIntent(sim, eid, IntentKind.Press, owner)
  }
  setIntent(sim, eid, IntentKind.Hold)
}

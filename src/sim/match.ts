// Match flow: kick-offs, restarts, goals, half time and full time.

import { placeBall } from './actions'
import { FOOT_REACH, TICK_RATE } from './constants'
import { IntentKind, setIntent } from './intents'
import { bestGroundPass, strikeGroundPass } from './passing'
import { kickOffTarget, type Point } from './shape'
import { attackDir, createSim, roleOf, type Sim } from './sim'
import { Phase, Restart, type MatchConfig } from './state'

const RESTART_DELAY = 1.5 * TICK_RATE
const GOAL_PAUSE = 3 * TICK_RATE
const HALF_TIME_PAUSE = 3 * TICK_RATE

export function newMatch(cfg?: MatchConfig): Sim {
  const sim = createSim(cfg)
  startKickOff(sim, sim.m.firstKickOff)
  return sim
}

export function halfTicks(sim: Sim): number {
  return sim.cfg.halfMinutes * 60 * TICK_RATE
}

/** Match clock in ticks: time played in earlier halves plus time into this one. */
export function matchClock(sim: Sim): number {
  const { m } = sim
  return (m.half - 1) * halfTicks(sim) + Math.min(m.tick - m.halfStartTick, halfTicks(sim))
}

function enterPhase(sim: Sim, phase: Phase) {
  sim.m.phase = phase
  sim.m.phaseTick = sim.m.tick
  sim.m.events.push({ type: 'phase', tick: sim.m.tick, phase })
  // A whistle cancels whatever players were about to do with the ball.
  if (phase === Phase.Goal || phase === Phase.HalfTime || phase === Phase.FullTime) {
    for (const eid of sim.players) setIntent(sim, eid, IntentKind.Hold)
  }
}

function setupRestart(sim: Sim, kind: Restart, team: number, x: number, y: number, taker: number) {
  placeBall(sim, x, y)
  sim.m.restart = { kind, team, x, y, taker }
  for (const eid of sim.players) setIntent(sim, eid, IntentKind.Hold)
  setIntent(sim, taker, IntentKind.TakeRestart)
  enterPhase(sim, kind === Restart.KickOff ? Phase.KickOff : Phase.Restart)
}

const p: Point = { x: 0, y: 0 }

export function startKickOff(sim: Sim, team: number): void {
  const { Pos, Vel, Facing } = sim.c
  const taker = sim.teams[team].find((eid) => roleOf(sim, eid) === 'ST') ?? sim.teams[team][9]
  for (const eid of sim.players) {
    const t = sim.c.Player.team[eid]
    kickOffTarget(sim, eid, t === team, p)
    Pos.x[eid] = p.x
    Pos.y[eid] = p.y
    Vel.x[eid] = 0
    Vel.y[eid] = 0
    Facing.a[eid] = attackDir(sim, t) > 0 ? 0 : Math.PI
  }
  Pos.x[taker] = -0.4 * attackDir(sim, team)
  Pos.y[taker] = 0
  sim.m.possession = team
  setupRestart(sim, Restart.KickOff, team, 0, 0, taker)
}

export function awardRestart(sim: Sim, kind: Restart, team: number, x: number, y: number): void {
  sim.m.events.push({ type: 'out', tick: sim.m.tick, restart: kind, team, x, y, lastTouch: sim.m.ball.lastTouch })
  setupRestart(sim, kind, team, x, y, chooseTaker(sim, kind, team, x, y))
}

export function awardGoal(sim: Sim, team: number): void {
  const { m, c, ball } = sim
  m.score[team]++
  m.events.push({ type: 'goal', tick: m.tick, team, scorer: m.ball.lastTouch })
  c.Vel.x[ball] = 0
  c.Vel.y[ball] = 0
  c.Air.vz[ball] = 0
  m.ball.owner = -1
  // The conceding team kicks off.
  m.restart.team = 1 - team
  enterPhase(sim, Phase.Goal)
}

function chooseTaker(sim: Sim, kind: Restart, team: number, x: number, y: number): number {
  const { Pos } = sim.c
  let best = -1
  let bestD = Infinity
  for (const eid of sim.teams[team]) {
    const isKeeper = roleOf(sim, eid) === 'GK'
    if (isKeeper !== (kind === Restart.GoalKick)) continue
    const d = (Pos.x[eid] - x) * (Pos.x[eid] - x) + (Pos.y[eid] - y) * (Pos.y[eid] - y)
    if (d < bestD) {
      best = eid
      bestD = d
    }
  }
  return best
}

/** Drives phase changes. Runs before players think each tick. */
export function matchSystem(sim: Sim): void {
  const { m, c, ball } = sim
  const elapsed = m.tick - m.phaseTick
  switch (m.phase) {
    case Phase.KickOff:
    case Phase.Restart: {
      const taker = m.restart.taker
      const dx = c.Pos.x[ball] - c.Pos.x[taker]
      const dy = c.Pos.y[ball] - c.Pos.y[taker]
      if (elapsed < RESTART_DELAY || dx * dx + dy * dy > FOOT_REACH * FOOT_REACH) return
      const backwards = m.restart.kind === Restart.KickOff
      const pass = bestGroundPass(sim, taker, backwards ? 4 : 6, 30)
      enterPhase(sim, Phase.Play)
      if (pass) strikeGroundPass(sim, taker, pass.target, pass.x, pass.y)
      setIntent(sim, taker, IntentKind.Hold)
      return
    }
    case Phase.Goal:
      if (elapsed >= GOAL_PAUSE) startKickOff(sim, m.restart.team)
      return
    case Phase.HalfTime:
      if (elapsed >= HALF_TIME_PAUSE) {
        m.half = 2
        m.halfStartTick = m.tick
        startKickOff(sim, 1 - m.firstKickOff)
      }
      return
    case Phase.Play:
      if (m.tick - m.halfStartTick >= halfTicks(sim)) enterPhase(sim, m.half === 1 ? Phase.HalfTime : Phase.FullTime)
      return
    case Phase.FullTime:
      return
  }
}

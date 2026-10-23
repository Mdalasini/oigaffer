import { describe, expect, test } from 'bun:test'
import { groundKickSpeed, rollDistance } from './ballmotion'
import { componentArrays } from './components'
import { TICK_RATE } from './constants'
import { awardRestart, newMatch } from './match'
import { HALF_LENGTH, HALF_WIDTH } from './pitch'
import { shapeTarget } from './shape'
import { attackDir, roleOf, type Sim } from './sim'
import { restore, snapshot } from './snapshot'
import { Phase, Restart, type MatchConfig } from './state'
import { step } from './step'

// Keep runs short: these execute on every `bun test`.
const CFG: MatchConfig = { seed: 7, halfMinutes: 45, formations: ['4-3-3', '3-4-3'] }

function run(sim: Sim, seconds: number) {
  const events = []
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    step(sim)
    events.push(...sim.m.events)
  }
  return events
}

function state(sim: Sim): string {
  return JSON.stringify([componentArrays(sim.c).map((a) => Array.from(a)), sim.m])
}

describe('match setup', () => {
  test('home lines up 4-3-3 and away 3-4-3, each in its own half', () => {
    const sim = newMatch(CFG)
    expect(sim.formations.map((f) => f.name)).toEqual(['4-3-3', '3-4-3'])
    expect(sim.teams[0].map((e) => roleOf(sim, e)).filter((r) => r === 'CB')).toHaveLength(2)
    expect(sim.teams[1].map((e) => roleOf(sim, e)).filter((r) => r === 'CB')).toHaveLength(3)
    for (const team of [0, 1]) {
      for (const eid of sim.teams[team]) {
        expect(sim.c.Pos.x[eid] * attackDir(sim, team)).toBeLessThanOrEqual(0)
      }
    }
    expect(sim.m.phase).toBe(Phase.KickOff)
  })
})

describe('ball motion', () => {
  test('a planned ground pass arrives at the planned speed over the planned distance', () => {
    for (const [d, arrive] of [
      [10, 4],
      [25, 5],
      [40, 6],
    ]) {
      expect(rollDistance(groundKickSpeed(d, arrive), arrive)).toBeCloseTo(d, 0)
    }
  })
})

describe('shape', () => {
  test('the defending block slides towards the ball', () => {
    const sim = newMatch(CFG)
    const cb = sim.teams[1][2]
    sim.m.possession = 0
    sim.c.Pos.y[sim.ball] = 0
    const centre = shapeTarget(sim, cb, { x: 0, y: 0 })
    sim.c.Pos.y[sim.ball] = 25
    const wide = shapeTarget(sim, cb, { x: 0, y: 0 })
    expect(wide.y).toBeGreaterThan(centre.y + 5)
  })
})

describe('play', () => {
  test('kick-off leads to passing, and everyone stays near the pitch', () => {
    const sim = newMatch(CFG)
    const events = run(sim, 20)
    expect(events.some((e) => e.type === 'phase' && e.phase === Phase.Play)).toBe(true)
    expect(events.filter((e) => e.type === 'kick').length).toBeGreaterThan(2)
    for (const eid of [...sim.players, sim.ball]) {
      expect(Number.isFinite(sim.c.Pos.x[eid])).toBe(true)
      expect(Math.abs(sim.c.Pos.x[eid])).toBeLessThan(HALF_LENGTH + 5)
      expect(Math.abs(sim.c.Pos.y[eid])).toBeLessThan(HALF_WIDTH + 5)
    }
  })

  test('a ball over the touchline is a throw-in to the other team', () => {
    const sim = newMatch(CFG)
    run(sim, 3)
    sim.m.phase = Phase.Play
    sim.m.ball.owner = -1
    sim.m.ball.lastTeam = 0
    sim.c.Pos.x[sim.ball] = 10
    sim.c.Pos.y[sim.ball] = HALF_WIDTH - 0.5
    sim.c.Vel.x[sim.ball] = 0
    sim.c.Vel.y[sim.ball] = 8
    for (const eid of sim.players) sim.c.Brain.noTouchUntil[eid] = sim.m.tick + 100
    const events = run(sim, 1)
    const out = events.find((e) => e.type === 'out')
    expect(out?.type === 'out' && [out.restart, out.team]).toEqual([Restart.ThrowIn, 1])
    expect(sim.m.phase as Phase).toBe(Phase.Restart)
  })

  test('a restart is taken by the awarded team', () => {
    const sim = newMatch(CFG)
    awardRestart(sim, Restart.GoalKick, 1, HALF_LENGTH - 5.5, 5)
    const events = run(sim, 6)
    const kick = events.find((e) => e.type === 'kick')
    expect(kick && kick.type === 'kick' && roleOf(sim, kick.by)).toBe('GK')
  })
})

describe('determinism', () => {
  test('restoring a snapshot replays identically', () => {
    const sim = newMatch(CFG)
    run(sim, 5)
    const snap = snapshot(sim)
    run(sim, 5)
    const a = state(sim)
    restore(sim, snap)
    run(sim, 5)
    expect(state(sim)).toBe(a)
  })

  test('the same seed gives the same match and another seed does not', () => {
    const a = newMatch(CFG)
    const b = newMatch(CFG)
    const c = newMatch({ ...CFG, seed: 8 })
    run(a, 5)
    run(b, 5)
    run(c, 5)
    expect(state(b)).toBe(state(a))
    expect(state(c)).not.toBe(state(a))
  })
})

describe('review regressions', () => {
  function loose(sim: Sim, x: number, y: number, vx: number, vy: number, lastTeam = 1) {
    sim.m.phase = Phase.Play
    sim.m.ball.owner = -1
    sim.m.ball.lastTeam = lastTeam
    sim.c.Pos.x[sim.ball] = x
    sim.c.Pos.y[sim.ball] = y
    sim.c.Vel.x[sim.ball] = vx
    sim.c.Vel.y[sim.ball] = vy
    for (const eid of sim.players) sim.c.Brain.noTouchUntil[eid] = sim.m.tick + 100
  }

  test('a ball that crosses the goal line wide of the post is not a goal even if it ends level with the goal', () => {
    const sim = newMatch(CFG)
    loose(sim, 52.6, 3.7, 9, -9)
    const events = run(sim, 0.1)
    expect(events.some((e) => e.type === 'goal')).toBe(false)
    expect(events.find((e) => e.type === 'out')).toBeDefined()
  })

  test('a ball that crosses the touchline first is a throw-in, not a goal kick', () => {
    const sim = newMatch(CFG)
    loose(sim, 52.4, 34.1, 9, 9)
    const out = run(sim, 0.1).find((e) => e.type === 'out')
    expect(out?.type === 'out' && out.restart).toBe(Restart.ThrowIn)
  })

  test('no one plays the ball after the half-time whistle', () => {
    const sim = newMatch({ ...CFG, halfMinutes: 0.25 })
    const events = run(sim, 20)
    const whistle = events.findIndex((e) => e.type === 'phase' && e.phase === Phase.HalfTime)
    expect(whistle).toBeGreaterThan(-1)
    const kickoff = events.findIndex((e, i) => i > whistle && e.type === 'phase' && e.phase === Phase.KickOff)
    expect(events.slice(whistle, kickoff).some((e) => e.type === 'kick')).toBe(false)
  })

  test('both halves get the full configured time', () => {
    const sim = newMatch({ ...CFG, halfMinutes: 0.25 })
    const events = run(sim, 40)
    const phases = events.filter((e) => e.type === 'phase')
    const half = phases.find((e) => e.phase === Phase.HalfTime)!.tick
    const full = phases.find((e) => e.phase === Phase.FullTime)!.tick
    expect(full - half).toBe(15 * TICK_RATE + 3 * TICK_RATE)
  })

  test('a snapshot refuses to restore into a sim built with another config', () => {
    const a = newMatch(CFG)
    const b = newMatch({ ...CFG, formations: ['3-4-3', '4-3-3'] })
    expect(() => restore(b, snapshot(a))).toThrow()
  })
})

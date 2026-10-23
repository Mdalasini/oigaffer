import { describe, expect, test } from 'bun:test'
import { kick } from './actions'
import { TICK_RATE } from './constants'
import type { SimEvent } from './events'
import { IntentKind, setIntent } from './intents'
import { keeperOf } from './keeper'
import { awardRestart, newMatch } from './match'
import { setShotPlan } from './onball'
import { revealAll } from './perception'
import { HALF_LENGTH, HALF_WIDTH, PENALTY_SPOT_DISTANCE } from './pitch'
import { book, refereeSystem } from './referee'
import { restore, snapshot } from './snapshot'
import { attackDir, roleOf, type Sim } from './sim'
import { Phase, Restart } from './state'
import { step } from './step'

const CFG = { seed: 16, halfMinutes: 45, formations: ['4-3-3', '3-4-3'] as [string, string] }

function emptyPitch(): Sim {
  const sim = newMatch(CFG)
  sim.m.phase = Phase.Play
  sim.players.forEach((eid, i) => place(sim, eid, -40 + i * 2, 33))
  return sim
}

function place(sim: Sim, eid: number, x: number, y: number, vx = 0, vy = 0) {
  sim.c.Pos.x[eid] = x
  sim.c.Pos.y[eid] = y
  sim.c.Vel.x[eid] = vx
  sim.c.Vel.y[eid] = vy
}

function run(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = []
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    step(sim)
    out.push(...sim.m.events)
  }
  return out
}

/** Home midfielder on the ball at halfway; away's three centre-backs at `line`; a home striker at `striker`. */
function throughBall(sim: Sim, line: number, striker: number) {
  const dir = attackDir(sim, 0)
  const passer = sim.teams[0][6]
  const st = sim.teams[0][9]
  place(sim, passer, -1 * dir, 0)
  place(sim, sim.ball, 0, 0)
  ;[-25, -15, 15].forEach((y, i) => place(sim, sim.teams[1][1 + i], line * dir, y))
  place(sim, keeperOf(sim, 1), 50 * dir, 0)
  place(sim, st, striker * dir, 3)
  sim.m.ball.owner = passer
  revealAll(sim)
  // Pass straight to the striker's feet.
  sim.m.events = []
  sim.m.refSeen = 0
  kick(sim, passer, (striker * dir) / 2.2, 3 / 2.2, 0, 'pass', st)
  refereeSystem(sim)
  return { dir, st }
}

describe('offside', () => {
  test('a striker beyond the last defender when the ball is played is offside once they play it', () => {
    const sim = emptyPitch()
    const { st } = throughBall(sim, 20, 25)
    const events = run(sim, 3)
    expect(events.find((e) => e.type === 'offside')).toMatchObject({ by: st })
    expect(sim.m.restart).toMatchObject({ kind: Restart.FreeKick, team: 1, indirect: true })
  })

  test('level with the second-last defender is onside', () => {
    const sim = emptyPitch()
    throughBall(sim, 20, 20)
    expect(run(sim, 3).some((e) => e.type === 'offside')).toBe(false)
  })

  test('there is no offside straight from a throw-in', () => {
    const sim = emptyPitch()
    const { st } = throughBall(sim, 20, 25)
    sim.m.offside = { team: -1, players: [] }
    sim.m.restart.kind = Restart.ThrowIn
    sim.m.phaseTick = sim.m.tick
    sim.m.events = []
    sim.m.refSeen = 0
    kick(sim, sim.teams[0][6], 25 / 2.2, 3 / 2.2, 0, 'pass', st)
    refereeSystem(sim)
    expect(sim.m.offside.players).toEqual([])
  })
})

describe('fouls and cards', () => {
  function foulAt(sim: Sim, x: number, y: number, extra: Partial<Extract<SimEvent, { type: 'tackle' }>> = {}) {
    const [fouled, fouler] = [sim.teams[0][9], sim.teams[1][2]]
    place(sim, fouled, x, y)
    place(sim, fouler, x + 1, y)
    place(sim, sim.ball, x + 0.5, y)
    sim.m.events = [
      { type: 'tackle', tick: sim.m.tick, by: fouler, on: fouled, kind: 'standing', outcome: 'foul', reckless: false, fromBehind: false, x, y, onVx: 0, onVy: 0, ...extra },
    ]
    sim.m.refSeen = 0
    refereeSystem(sim)
    return { fouled, fouler }
  }

  test('a foul in midfield is a free kick to the fouled side at the spot', () => {
    const sim = emptyPitch()
    foulAt(sim, -10 * attackDir(sim, 0), 5)
    expect(sim.m.restart).toMatchObject({ kind: Restart.FreeKick, team: 0, indirect: false })
    expect(sim.m.phase as Phase).toBe(Phase.Restart)
  })

  test('a foul in the penalty area is a penalty from the spot', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    foulAt(sim, (HALF_LENGTH - 8) * dir, 3)
    expect(sim.m.restart).toMatchObject({ kind: Restart.Penalty, team: 0, x: (HALF_LENGTH - PENALTY_SPOT_DISTANCE) * dir, y: 0 })
  })

  test('a reckless challenge is booked', () => {
    const sim = emptyPitch()
    sim.c.Attr.aggression.fill(0)
    sim.m.rng.s = 7
    const { fouler } = foulAt(sim, -10 * attackDir(sim, 0), 5, { kind: 'slide', reckless: true, fromBehind: true })
    expect(sim.m.events.find((e) => e.type === 'card' && e.to === fouler)).toBeDefined()
  })

  test('a second yellow sends the player off and the team plays a man short', () => {
    const sim = emptyPitch()
    const fouler = sim.teams[1][2]
    book(sim, fouler, 'yellow', 'test')
    expect(sim.teams[1]).toContain(fouler)
    book(sim, fouler, 'yellow', 'test')
    expect(sim.m.events.filter((e) => e.type === 'card').map((e) => e.type === 'card' && e.color)).toEqual(['yellow', 'yellow', 'red'])
    expect(sim.teams[1]).toHaveLength(10)
    expect(sim.players).not.toContain(fouler)
    // Still off after a snapshot round trip.
    const snap = JSON.parse(JSON.stringify(snapshot(sim)))
    const again = newMatch(CFG)
    restore(again, snap)
    expect(again.teams[1]).toHaveLength(10)
  })

  test('a sent-off keeper is replaced in goal by a defender', () => {
    const sim = emptyPitch()
    const gk = keeperOf(sim, 1)
    book(sim, gk, 'red', 'test')
    const stand = keeperOf(sim, 1)
    expect(stand).toBeDefined()
    expect(stand).not.toBe(gk)
    expect(roleOf(sim, stand)).toBe('GK')
  })
})

describe('indirect free kicks', () => {
  test('an indirect free kick struck straight into the net is a goal kick, not a goal', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    const taker = sim.teams[0][9]
    place(sim, taker, (HALF_LENGTH - 12) * dir, 0)
    place(sim, keeperOf(sim, 1), HALF_LENGTH * dir, 30)
    place(sim, sim.ball, (HALF_LENGTH - 11.5) * dir, 0)
    sim.m.ball.indirectFrom = taker
    kick(sim, taker, 25 * dir, 0, 1, 'shot')
    sim.m.ball.indirectFrom = taker
    for (const e of sim.players) setIntent(sim, e, IntentKind.Wait)
    sim.c.Brain.nextThink.fill(1e9)
    const events = run(sim, 2)
    expect(events.some((e) => e.type === 'goal')).toBe(false)
    expect(events.find((e) => e.type === 'out')).toMatchObject({ restart: Restart.GoalKick })
  })
})

describe('review regressions', () => {
  test('a shot by a player flagged offside is an offside, not a goal', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    const st = sim.teams[0][9]
    place(sim, st, (HALF_LENGTH - 1) * dir, 0)
    place(sim, sim.ball, (HALF_LENGTH - 0.6) * dir, 0)
    place(sim, keeperOf(sim, 1), HALF_LENGTH * dir, 20)
    sim.m.offside = { team: 0, players: [st] }
    sim.m.ball.owner = st
    sim.m.score = [0, 0]
    sim.c.Brain.nextThink.fill(1e9)
    // Shoots this tick, from a couple of metres: the ball would cross the line within the same step.
    setShotPlan(sim, st, { x: HALF_LENGTH * dir, y: 0, z: 0.3, xg: 0.9 })
    setIntent(sim, st, IntentKind.Shoot)
    sim.c.Attr.shooting[st] = 1
    for (let i = 0; i < 5; i++) step(sim)
    expect(sim.m.score).toEqual([0, 0])
    expect(sim.m.restart).toMatchObject({ kind: Restart.FreeKick, team: 1, indirect: true })
  })

  test('offside positions are taken where players stood when the ball was played', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    const passer = sim.teams[0][6]
    const mate = sim.teams[0][9]
    place(sim, passer, 19.6 * dir, 0)
    place(sim, sim.ball, 20 * dir, 0)
    place(sim, mate, 20.5 * dir, 8)
    ;[-25, 20, 25].forEach((y, i) => place(sim, sim.teams[1][1 + i], 20 * dir, y))
    place(sim, keeperOf(sim, 1), 50 * dir, 0)
    sim.m.ball.owner = passer
    revealAll(sim)
    sim.c.Brain.nextThink.fill(1e9)
    for (const e of sim.players) setIntent(sim, e, IntentKind.Wait)
    // Played forward at pace inside the step, so the ball has moved on by the end of the tick.
    sim.c.Plan.type[passer] = 0
    setIntent(sim, passer, IntentKind.Pass, mate, 40 * dir, 8)
    sim.c.Plan.x[passer] = 40 * dir
    sim.c.Plan.y[passer] = 8
    sim.c.Plan.target[passer] = mate
    step(sim)
    expect(sim.m.events.some((e) => e.type === 'kick')).toBe(true)
    expect(sim.m.offside.players).toContain(mate)
  })

  test('a stoppage clears who was offside', () => {
    const sim = emptyPitch()
    const st = sim.teams[0][9]
    sim.m.offside = { team: 0, players: [st] }
    awardRestart(sim, Restart.ThrowIn, 0, 0, HALF_WIDTH)
    expect(sim.m.offside.players).toEqual([])
  })

  test('advantage comes back for the free kick when the other side wins the ball', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    const [fouled, fouler, mate] = [sim.teams[0][9], sim.teams[1][2], sim.teams[0][8]]
    const x = 20 * dir
    place(sim, fouled, x, 0)
    place(sim, fouler, x + 1, 0)
    place(sim, mate, x + 0.5, 1.5)
    place(sim, sim.ball, x + 0.5, 0)
    sim.m.ball.owner = -1
    sim.m.events = [{ type: 'tackle', tick: sim.m.tick, by: fouler, on: fouled, kind: 'standing', outcome: 'foul', reckless: false, fromBehind: false, x, y: 0, onVx: 0, onVy: 0 }]
    sim.m.refSeen = 0
    refereeSystem(sim)
    expect(sim.m.phase as Phase).toBe(Phase.Play)
    // The fouler picks it up instead.
    sim.m.ball.owner = fouler
    refereeSystem(sim)
    expect(sim.m.restart).toMatchObject({ kind: Restart.FreeKick, team: 0 })
  })

  test('a foul that stops a fast break is judged on the pace before the contact', () => {
    let booked = 0
    for (let seed = 1; seed <= 20; seed++) {
      const sim = emptyPitch()
      sim.m.rng.s = seed
      const dir = attackDir(sim, 0)
      const [fouled, fouler] = [sim.teams[0][9], sim.teams[1][2]]
      place(sim, fouled, -5 * dir, 0, 2.4 * dir, 0)
      sim.m.events = [{ type: 'tackle', tick: sim.m.tick, by: fouler, on: fouled, kind: 'standing', outcome: 'foul', reckless: false, fromBehind: false, x: -5 * dir, y: 0, onVx: 8 * dir, onVy: 0 }]
      sim.m.refSeen = 0
      refereeSystem(sim)
      if (sim.m.yellows[fouler]) booked++
    }
    expect(booked).toBeGreaterThan(5)
  })

  test('a save does not reset offside, and a teammate’s control refreshes it', () => {
    const sim = emptyPitch()
    const st = sim.teams[0][9]
    sim.m.offside = { team: 0, players: [st] }
    sim.m.events = [{ type: 'save', tick: sim.m.tick, by: keeperOf(sim, 1), kind: 'parry', speed: 20 }]
    sim.m.refSeen = 0
    refereeSystem(sim)
    expect(sim.m.offside.players).toEqual([st])
    // An onside teammate controls it, with the striker now behind the ball.
    const dir = attackDir(sim, 0)
    const mate = sim.teams[0][8]
    place(sim, mate, 30 * dir, 0)
    place(sim, sim.ball, 30 * dir, 0)
    place(sim, st, 20 * dir, 0)
    sim.m.events = [{ type: 'control', tick: sim.m.tick, by: mate, x: 30 * dir, y: 0, clean: true }]
    sim.m.refSeen = 0
    refereeSystem(sim)
    expect(sim.m.offside.players).not.toContain(st)
  })
})

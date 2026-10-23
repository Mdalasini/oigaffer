import { describe, expect, test } from 'bun:test'
import type { BallState } from './ballmotion'
import { updateScratch } from './brain'
import { TICK_RATE } from './constants'
import type { SimEvent } from './events'
import { collideGoalFrame } from './goalframe'
import { IntentKind } from './intents'
import { canHandle, keeperOf, keeperPosition, keeperSystem } from './keeper'
import { takeControl } from './actions'
import { newMatch } from './match'
import { decideOnBall } from './onball'
import { revealAll } from './perception'
import { GOAL_WIDTH, HALF_LENGTH } from './pitch'
import { estimateXg } from './shooting'
import { attackDir, type Sim } from './sim'
import { Phase } from './state'
import { step } from './step'

const CFG = { seed: 6, halfMinutes: 45, formations: ['4-3-3', '3-4-3'] as [string, string] }

/** Open play with everyone parked out of the way along one touchline. */
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

function launchBall(sim: Sim, x: number, y: number, z: number, vx: number, vy: number, vz: number, lastTeam: number) {
  place(sim, sim.ball, x, y, vx, vy)
  sim.c.Air.z[sim.ball] = z
  sim.c.Air.vz[sim.ball] = vz
  sim.m.ball.owner = -1
  sim.m.ball.lastTeam = lastTeam
  sim.m.ball.lastKick = 'shot'
}

function run(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = []
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    step(sim)
    out.push(...sim.m.events)
  }
  return out
}

describe('goal frame', () => {
  test('a ball struck at a post bounces back off it', () => {
    const b: BallState = { x: HALF_LENGTH + 0.3, y: GOAL_WIDTH / 2, z: 0.5, vx: 20, vy: 0, vz: 0 }
    const from = { x: HALF_LENGTH - 0.4, y: GOAL_WIDTH / 2, z: 0.5 }
    expect(collideGoalFrame(from.x, from.y, from.z, b)).toBe(true)
    expect(b.vx).toBeLessThan(0)
    expect(b.x).toBeLessThan(HALF_LENGTH)
  })

  test('a glancing hit on the inside of the post is still a hit', () => {
    const b: BallState = { x: 52.8, y: 3.52, z: 0.5, vx: 21, vy: 0, vz: 0 }
    expect(collideGoalFrame(52.1, 3.52, 0.5, b)).toBe(true)
    // Deflected inwards, into the goal mouth.
    expect(b.vy).toBeLessThan(0)
  })

  test('a ball under the bar and between the posts touches nothing', () => {
    const b: BallState = { x: HALF_LENGTH + 0.3, y: 0, z: 1, vx: 20, vy: 0, vz: 0 }
    expect(collideGoalFrame(HALF_LENGTH - 0.4, 0, 1, b)).toBe(false)
  })

  test('a shot that hits the bar stays out', () => {
    const b: BallState = { x: HALF_LENGTH + 0.3, y: 0, z: 2.44, vx: 20, vy: 0, vz: 0 }
    expect(collideGoalFrame(HALF_LENGTH - 0.4, 0, 2.44, b)).toBe(true)
    expect(b.vx).toBeLessThan(0)
  })
})

describe('chance quality', () => {
  test('closer and more central is a better chance, and a defender in the way makes it worse', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    const striker = sim.teams[0][9]
    const gx = dir * HALF_LENGTH
    place(sim, striker, gx - dir * 10, 0)
    revealAll(sim)
    const close = estimateXg(sim, striker, gx - dir * 10, 0)
    const far = estimateXg(sim, striker, gx - dir * 25, 0)
    const wide = estimateXg(sim, striker, gx - dir * 10, 15)
    expect(close).toBeGreaterThan(far)
    expect(close).toBeGreaterThan(wide)
    place(sim, sim.teams[1][2], gx - dir * 6, 0)
    revealAll(sim)
    expect(estimateXg(sim, striker, gx - dir * 10, 0)).toBeLessThan(close)
  })

  test('an unmarked striker 10 m out shoots', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    const striker = sim.teams[0][9]
    place(sim, striker, dir * (HALF_LENGTH - 10), 1)
    place(sim, sim.ball, dir * (HALF_LENGTH - 9.5), 1)
    place(sim, keeperOf(sim, 1), dir * (HALF_LENGTH - 1), 0)
    sim.m.ball.owner = striker
    revealAll(sim)
    decideOnBall(sim, striker)
    expect(sim.c.Intent.kind[striker]).toBe(IntentKind.Shoot)
  })
})

describe('headers', () => {
  test('a striker meets a ball at head height in the box with a header at goal', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    const striker = sim.teams[0][9]
    const gx = dir * HALF_LENGTH
    place(sim, striker, gx - dir * 8, 0)
    place(sim, keeperOf(sim, 1), gx - dir * 6, 30)
    revealAll(sim)
    launchBall(sim, gx - dir * 8, -2.2, 1.9, 0, 9, 0.5, 0)
    const header = run(sim, 0.5).find((e) => e.type === 'kick' && e.kind === 'header')
    expect(header).toMatchObject({ by: striker })
    expect(sim.c.Vel.x[sim.ball] * dir).toBeGreaterThan(5)
  })
})

describe('goalkeeping', () => {
  test('the keeper shifts across with the ball and comes off the line as it nears', () => {
    const sim = emptyPitch()
    const gk = keeperOf(sim, 0)
    const own = -attackDir(sim, 0) * HALF_LENGTH
    place(sim, sim.ball, own * 0.3, 20)
    revealAll(sim)
    const far = keeperPosition(sim, gk, { x: 0, y: 0 })
    place(sim, sim.ball, own * 0.75, 10)
    revealAll(sim)
    const near = keeperPosition(sim, gk, { x: 0, y: 0 })
    expect(near.y).toBeGreaterThan(0)
    expect(Math.abs(near.x)).toBeLessThan(HALF_LENGTH)
    expect(Math.abs(far.x)).toBeLessThan(Math.abs(near.x))
  })

  test('a soft shot at the keeper is held, then released within a few seconds', () => {
    const sim = emptyPitch()
    const gk = keeperOf(sim, 1)
    const dir = attackDir(sim, 1)
    const line = -dir * HALF_LENGTH
    place(sim, gk, line + dir * 1.5, 0)
    revealAll(sim)
    launchBall(sim, line + dir * 12, 0, 0, -dir * 9, 0, 0, 0)
    const events = run(sim, 8)
    expect(events.find((e) => e.type === 'save')).toMatchObject({ by: gk, kind: 'catch' })
    const out = events.find((e) => e.type === 'kick' && e.by === gk)
    expect(out && out.type === 'kick' && ['rollout', 'throw', 'punt']).toContain(out && out.type === 'kick' ? out.pass : '')
  })

  test('the keeper comes for a cross dropping into the six-yard box, calls for it and holds it', () => {
    const sim = emptyPitch()
    const gk = keeperOf(sim, 1)
    const dir = attackDir(sim, 1)
    const line = -dir * HALF_LENGTH
    place(sim, gk, line + dir * 2, 0)
    place(sim, sim.teams[0][9], line + dir * 9, 4)
    // A centre-back near enough to hear the call.
    place(sim, sim.teams[1][2], line + dir * 8, 8)
    revealAll(sim)
    // A cross from the right wing, dropping about 6 m out.
    launchBall(sim, line + dir * 10, -25, 0.2, -dir * 2, 13, 7, 0)
    sim.m.ball.lastKick = 'pass'
    const events = run(sim, 3)
    expect(events.some((e) => e.type === 'call' && e.call === 'keeper' && e.by === gk)).toBe(true)
    expect(events.find((e) => e.type === 'save')).toMatchObject({ by: gk })
  })

  test('the keeper cannot pick up a deliberate back pass', () => {
    const sim = emptyPitch()
    const gk = keeperOf(sim, 1)
    const dir = attackDir(sim, 1)
    const line = -dir * HALF_LENGTH
    place(sim, gk, line + dir * 3, 0)
    revealAll(sim)
    launchBall(sim, line + dir * 12, 0, 0, -dir * 6, 0, 0, 1)
    sim.m.ball.lastKick = 'pass'
    sim.m.ball.backPassTeam = 1
    const events = run(sim, 2)
    expect(events.some((e) => e.type === 'save')).toBe(false)
    expect(events.find((e) => e.type === 'control')).toMatchObject({ by: gk })
  })

  test('a back pass the keeper miscontrols still cannot be picked up', () => {
    const sim = emptyPitch()
    const gk = keeperOf(sim, 1)
    sim.m.ball.backPassTeam = 1
    sim.m.ball.lastTeam = 1
    takeControl(sim, gk, false, 1, 0)
    expect(canHandle(sim, gk)).toBe(false)
  })

  test('a keeper reacts to a real header at goal', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    const striker = sim.teams[0][9]
    const gk = keeperOf(sim, 1)
    const gx = dir * HALF_LENGTH
    place(sim, striker, gx - dir * 8, 0)
    place(sim, gk, gx - dir * 1.5, 0)
    revealAll(sim)
    launchBall(sim, gx - dir * 8, -2.2, 1.9, 0, 9, 0.5, 0)
    let dived = false
    for (let i = 0; i < 20 && !dived; i++) {
      step(sim)
      dived = sim.c.Keeper.diveAt[gk] >= 0 || sim.c.Intent.kind[gk] === IntentKind.Dive
    }
    expect(dived).toBe(true)
  })

  test('a keeper reacts to a shot towards the corner by diving that way', () => {
    const sim = emptyPitch()
    const gk = keeperOf(sim, 1)
    const dir = attackDir(sim, 1)
    const line = -dir * HALF_LENGTH
    const striker = sim.teams[0][9]
    place(sim, gk, line + dir * 2, 0)
    place(sim, striker, line + dir * 20, 0)
    revealAll(sim)
    updateScratch(sim)
    // A shot from 20 m towards the far corner, then let the keeper see the kick.
    launchBall(sim, line + dir * 19.5, 0, 0, -dir * 22, 2.6, 1.5, 0)
    sim.m.events = [{ type: 'kick', tick: sim.m.tick, by: striker, kind: 'shot', to: -1, x: 0, y: 0 }]
    keeperSystem(sim)
    let dived = false
    for (let i = 0; i < TICK_RATE && !dived; i++) {
      step(sim)
      dived = sim.c.Intent.kind[gk] === IntentKind.Dive
    }
    expect(dived).toBe(true)
    expect(sim.c.Intent.y[gk]).toBeGreaterThan(1.5)
  })
})

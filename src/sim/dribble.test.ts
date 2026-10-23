import { describe, expect, test } from 'bun:test'
import { TICK_RATE } from './constants'
import { chooseDribble, DribbleMode } from './dribble'
import { IntentKind, setIntent } from './intents'
import { newMatch } from './match'
import { decideOnBall } from './onball'
import { revealAll } from './perception'
import { attackDir, type Sim } from './sim'
import { Phase } from './state'
import { step } from './step'
import { separationSystem } from './systems/locomotion'

const CFG = { seed: 8, halfMinutes: 45, formations: ['4-3-3', '3-4-3'] as [string, string] }

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

/** A home carrier at the centre spot with the ball at their feet, facing the away goal. */
function carrierAtCentre(sim: Sim) {
  const dir = attackDir(sim, 0)
  const carrier = sim.teams[0][6]
  place(sim, carrier, 0, 0)
  place(sim, sim.ball, 0.4 * dir, 0)
  sim.c.Facing.a[carrier] = dir > 0 ? 0 : Math.PI
  sim.m.ball.owner = carrier
  sim.m.possession = 0
  return { carrier, dir }
}

describe('choosing a dribble', () => {
  test('open grass ahead: sprint', () => {
    const sim = emptyPitch()
    const { carrier, dir } = carrierAtCentre(sim)
    revealAll(sim)
    expect(chooseDribble(sim, carrier, 10 * dir, 0, false).mode).toBe(DribbleMode.Sprint)
  })

  test('a defender squared up a few metres ahead: face up', () => {
    const sim = emptyPitch()
    const { carrier, dir } = carrierAtCentre(sim)
    // Another defender covering the space beyond, so there is nothing to knock it into.
    place(sim, sim.teams[1][5], 4 * dir, 0)
    place(sim, sim.teams[1][6], 10 * dir, 1)
    revealAll(sim)
    const choice = chooseDribble(sim, carrier, 10 * dir, 0, false)
    expect(choice.knockOn).toBeNull()
    expect(choice.mode).toBe(DribbleMode.FaceUp)
  })

  test('a lone, slower defender ahead with space behind: knock it past and race onto it', () => {
    const sim = emptyPitch()
    const { carrier, dir } = carrierAtCentre(sim)
    const defender = sim.teams[1][2]
    sim.c.Attr.pace[carrier] = 0.95
    sim.c.Attr.pace[defender] = 0.3
    place(sim, defender, 5 * dir, 0.5)
    sim.c.Attr.dribbling[carrier] = 0.9
    revealAll(sim)
    // Taking a man on is chosen some of the time, so give them a few looks at it.
    for (let i = 0; i < 20 && sim.c.Intent.kind[carrier] !== IntentKind.Pass; i++) {
      sim.c.Brain.takeOnReady[carrier] = 0
      decideOnBall(sim, carrier)
    }
    expect(sim.c.Intent.kind[carrier]).toBe(IntentKind.Pass)
    expect(sim.c.Plan.target[carrier]).toBe(carrier)
    const events = []
    for (let i = 0; i < TICK_RATE; i++) {
      step(sim)
      events.push(...sim.m.events)
    }
    expect(events.find((e) => e.type === 'kick')).toMatchObject({ kind: 'knock-on', by: carrier, to: carrier })
  })

  test('someone tight on the carrier from behind with no pass on: shield', () => {
    const sim = emptyPitch()
    const { carrier, dir } = carrierAtCentre(sim)
    place(sim, sim.teams[1][9], -1.2 * dir, 0.3)
    revealAll(sim)
    expect(chooseDribble(sim, carrier, 10 * dir, 0, false).mode).toBe(DribbleMode.Shield)
  })
})

describe('shielding and jostling', () => {
  test('a shielding carrier keeps the ball on the far side of their body', () => {
    const sim = emptyPitch()
    const { carrier, dir } = carrierAtCentre(sim)
    const opp = sim.teams[1][9]
    place(sim, opp, -1.2 * dir, 0)
    revealAll(sim)
    setIntent(sim, carrier, IntentKind.Carry, -1, 10 * dir, 0, DribbleMode.Shield)
    sim.c.Brain.nextThink[carrier] = 1e9
    sim.c.Brain.nextThink[opp] = 1e9
    setIntent(sim, opp, IntentKind.Wait)
    for (let i = 0; i < TICK_RATE; i++) step(sim)
    const toBall = (sim.c.Pos.x[sim.ball] - sim.c.Pos.x[carrier]) * dir
    const toOpp = (sim.c.Pos.x[opp] - sim.c.Pos.x[carrier]) * dir
    expect(Math.sign(toBall)).toBe(-Math.sign(toOpp))
  })

  test('in a shoulder-to-shoulder overlap the stronger player gives less ground', () => {
    const sim = emptyPitch()
    const [strong, weak] = [sim.teams[0][2], sim.teams[1][9]]
    sim.c.Attr.strength[strong] = 0.95
    sim.c.Attr.strength[weak] = 0.3
    place(sim, strong, 0, 0)
    place(sim, weak, 0.4, 0)
    separationSystem(sim)
    expect(Math.abs(sim.c.Pos.x[strong])).toBeLessThan(Math.abs(sim.c.Pos.x[weak] - 0.4))
  })
})

describe('review regressions', () => {
  test('a knock-on goes round the side the defender is not on', () => {
    const sim = emptyPitch()
    const { carrier, dir } = carrierAtCentre(sim)
    const defender = sim.teams[1][2]
    sim.c.Attr.pace[carrier] = 0.95
    sim.c.Attr.pace[defender] = 0.3
    sim.c.Attr.dribbling[carrier] = 0.9
    place(sim, defender, 5 * dir, 0.5 * dir)
    revealAll(sim)
    for (let i = 0; i < 20 && sim.c.Intent.kind[carrier] !== IntentKind.Pass; i++) {
      sim.c.Brain.takeOnReady[carrier] = 0
      decideOnBall(sim, carrier)
    }
    expect(sim.c.Plan.y[carrier] * dir).toBeLessThan(0)
  })

  test('after a knock-on the carrier chases the ball rather than running somewhere else', () => {
    const sim = emptyPitch()
    const { carrier, dir } = carrierAtCentre(sim)
    const defender = sim.teams[1][2]
    sim.c.Attr.pace[carrier] = 0.95
    sim.c.Attr.pace[defender] = 0.3
    sim.c.Attr.dribbling[carrier] = 0.9
    sim.c.Attr.vision[carrier] = 1
    place(sim, defender, 5 * dir, 0.5)
    revealAll(sim)
    for (let i = 0; i < 20 && sim.c.Intent.kind[carrier] !== IntentKind.Pass; i++) {
      sim.c.Brain.takeOnReady[carrier] = 0
      decideOnBall(sim, carrier)
    }
    let kicked = false
    for (let i = 0; i < TICK_RATE && !kicked; i++) {
      step(sim)
      kicked = sim.m.events.some((e) => e.type === 'kick' && e.kind === 'knock-on')
    }
    expect(kicked).toBe(true)
    expect(sim.c.Intent.kind[carrier]).toBe(IntentKind.Receive)
    expect(sim.m.events.some((e) => e.type === 'call')).toBe(false)
  })

  test('a sprinting dribbler actually reaches sprinting speed', () => {
    const sim = emptyPitch()
    const { carrier, dir } = carrierAtCentre(sim)
    sim.c.Attr.pace[carrier] = 0.9
    sim.c.Attr.dribbling[carrier] = 0.9
    revealAll(sim)
    let fastest = 0
    for (let i = 0; i < 5 * TICK_RATE; i++) {
      setIntent(sim, carrier, IntentKind.Carry, -1, sim.c.Pos.x[carrier] + 20 * dir, 0, DribbleMode.Sprint)
      sim.c.Brain.nextThink[carrier] = sim.m.tick + 100
      step(sim)
      fastest = Math.max(fastest, Math.hypot(sim.c.Vel.x[carrier], sim.c.Vel.y[carrier]))
    }
    expect(fastest).toBeGreaterThan(7)
  })
})

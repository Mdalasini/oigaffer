import { describe, expect, test } from 'bun:test'
import { TICK_RATE } from './constants'
import { challenge, contain, isGrounded, TackleKind } from './defending'
import type { SimEvent } from './events'
import { IntentKind, setIntent } from './intents'
import { newMatch } from './match'
import { decideOnBall } from './onball'
import { revealAll } from './perception'
import { HALF_LENGTH } from './pitch'
import { attackDir, type Sim } from './sim'
import { Phase } from './state'
import { step } from './step'

const CFG = { seed: 12, halfMinutes: 45, formations: ['4-3-3', '3-4-3'] as [string, string] }

function emptyPitch(seed = CFG.seed): Sim {
  const sim = newMatch({ ...CFG, seed })
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

/** Home carrier with the ball at their feet; an away defender `gap` metres goal side. */
function duel(sim: Sim, gap: number) {
  const dir = attackDir(sim, 0)
  const carrier = sim.teams[0][9]
  const defender = sim.teams[1][2]
  place(sim, carrier, 0, 0)
  place(sim, sim.ball, 0.3 * dir, 0)
  sim.c.Facing.a[carrier] = dir > 0 ? 0 : Math.PI
  place(sim, defender, gap * dir, 0)
  sim.c.Facing.a[defender] = dir > 0 ? Math.PI : 0
  sim.m.ball.owner = carrier
  sim.m.possession = 0
  revealAll(sim)
  return { dir, carrier, defender }
}

function collect(sim: Sim, seconds: number, freeze: number[]): SimEvent[] {
  const out: SimEvent[] = []
  for (const e of freeze) sim.c.Brain.nextThink[e] = 1e9
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    step(sim)
    out.push(...sim.m.events)
  }
  return out
}

describe('containing', () => {
  test('a jockeying defender holds a goal-side gap rather than diving in', () => {
    const sim = emptyPitch()
    const { dir, carrier, defender } = duel(sim, 6)
    setIntent(sim, defender, IntentKind.Press, carrier)
    contain(sim, defender, 8)
    // Target is between the carrier and the defender's goal, about two metres off.
    const tx = sim.c.Motor.tx[defender]
    expect(tx * dir).toBeGreaterThan(1)
    expect(tx * dir).toBeLessThan(3)
  })
})

describe('challenges', () => {
  test('a standing tackle on an exposed ball is resolved once, as won, missed or foul', () => {
    const sim = emptyPitch()
    const { dir, carrier, defender } = duel(sim, 1.4)
    place(sim, sim.ball, 0.9 * dir, 0)
    setIntent(sim, defender, IntentKind.Tackle, carrier, 0, 0, TackleKind.Standing)
    setIntent(sim, carrier, IntentKind.Wait)
    const events = collect(sim, 0.5, [carrier, defender])
    const tackles = events.filter((e) => e.type === 'tackle')
    expect(tackles).toHaveLength(1)
    expect(['won', 'missed', 'foul']).toContain(tackles[0].type === 'tackle' ? tackles[0].outcome : '')
  })

  test('good tacklers win more standing tackles than poor ones', () => {
    const wins = (tackling: number) => {
      let won = 0
      for (let seed = 1; seed <= 40; seed++) {
        const sim = emptyPitch(seed)
        const { dir, carrier, defender } = duel(sim, 1.2)
        sim.c.Attr.tackling[defender] = tackling
        place(sim, sim.ball, 0.7 * dir, 0)
        setIntent(sim, defender, IntentKind.Tackle, carrier, 0, 0, TackleKind.Standing)
        setIntent(sim, carrier, IntentKind.Wait)
        const t = collect(sim, 0.3, [carrier, defender]).find((e) => e.type === 'tackle')
        if (t && t.type === 'tackle' && t.outcome === 'won') won++
      }
      return won
    }
    expect(wins(0.95)).toBeGreaterThan(wins(0.2))
  })

  test('a sliding defender ends up on the ground for a while', () => {
    const sim = emptyPitch()
    const { carrier, defender } = duel(sim, 3)
    setIntent(sim, defender, IntentKind.Tackle, carrier, 0, 0, TackleKind.Slide)
    sim.c.Body.lungeUntil[defender] = sim.m.tick + 13
    sim.c.Body.downUntil[defender] = sim.m.tick + 47
    challenge(sim, defender, 8)
    for (let i = 0; i < 20; i++) step(sim)
    expect(isGrounded(sim, defender)).toBe(true)
  })

  test('a slide through the back of the man is a reckless foul when it is a foul', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const sim = emptyPitch(seed)
      const { dir, carrier, defender } = duel(sim, 0)
      place(sim, defender, -1.2 * dir, 0)
      setIntent(sim, defender, IntentKind.Tackle, carrier, 0, 0, TackleKind.Slide)
      sim.c.Body.lungeUntil[defender] = sim.m.tick + 13
      sim.c.Body.downUntil[defender] = sim.m.tick + 47
      setIntent(sim, carrier, IntentKind.Wait)
      const t = collect(sim, 0.5, [carrier, defender]).find((e) => e.type === 'tackle')
      if (t && t.type === 'tackle') {
        expect(t.fromBehind).toBe(true)
        if (t.outcome === 'foul') return expect(t.reckless).toBe(true)
      }
    }
    throw new Error('no foul from behind in 30 seeds')
  })
})

describe('clearances', () => {
  test('pressed near their own goal with nothing on, a defender clears it long', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 1)
    const cb = sim.teams[1][2]
    const own = -dir * HALF_LENGTH
    place(sim, cb, own + dir * 10, 4)
    place(sim, sim.ball, own + dir * 10.4, 4)
    place(sim, sim.teams[0][9], own + dir * 8.5, 4)
    // Every teammate, keeper included, has an opponent in front of them, on the ball side.
    const markers = sim.teams[0].filter((e) => e !== sim.teams[0][9])
    sim.teams[1]
      .filter((e) => e !== cb)
      .forEach((mate, i) => {
        const x = own + dir * (2 + i * 6)
        place(sim, mate, x, -20)
        place(sim, markers[i], x, -20 + 1.2)
      })
    sim.m.ball.owner = cb
    sim.m.possession = 1
    revealAll(sim)
    decideOnBall(sim, cb)
    expect(sim.c.Intent.kind[cb]).toBe(IntentKind.Pass)
    expect(sim.c.Plan.target[cb]).toBe(-1)
    expect((sim.c.Plan.x[cb] - sim.c.Pos.x[cb]) * dir).toBeGreaterThan(30)
  })
})

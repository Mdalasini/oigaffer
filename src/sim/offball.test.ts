import { describe, expect, test } from 'bun:test'
import { updateScratch } from './brain'
import { IntentKind, setIntent } from './intents'
import { newMatch } from './match'
import { decideSupport, onsideLimit, openPlayTarget, updateTeamShape } from './offball'
import { revealAll } from './perception'
import { roleOf, attackDir, type Sim } from './sim'
import { Phase } from './state'
import { shapeTarget } from './shape'

const CFG = { seed: 14, halfMinutes: 45, formations: ['4-3-3', '3-4-3'] as [string, string] }

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

/** Home has the ball with a midfielder; away's back four (3-4-3: back three plus a wing-back) at `line`. */
function attack(sim: Sim, line: number) {
  const dir = attackDir(sim, 0)
  const carrier = sim.teams[0][6]
  place(sim, carrier, 0, 0)
  place(sim, sim.ball, 0.4 * dir, 0)
  sim.m.ball.owner = carrier
  sim.m.possession = 0
  ;[-20, -8, 4, 16].forEach((y, i) => place(sim, sim.teams[1][1 + i], line * dir, y))
  place(sim, sim.teams[1][0], 50 * dir, 0)
  // Everyone else in the away team upfield of the ball, out of the way.
  sim.teams[1].slice(5).forEach((e, i) => place(sim, e, -30 * dir, -30 + i * 6))
  return { dir, carrier }
}

describe('with the ball', () => {
  test('the onside limit is the second-last defender, or halfway, or the ball', () => {
    const sim = emptyPitch()
    attack(sim, 20)
    const striker = sim.teams[0][9]
    revealAll(sim)
    expect(onsideLimit(sim, striker)).toBeCloseTo(20, 5)
    attack(sim, -5)
    revealAll(sim)
    expect(onsideLimit(sim, striker)).toBeCloseTo(0.4, 5)
  })

  test('a forward waiting for the ball stays onside', () => {
    const sim = emptyPitch()
    const { dir } = attack(sim, 10)
    const striker = sim.teams[0][9]
    place(sim, striker, 18 * dir, 0)
    revealAll(sim)
    const t = openPlayTarget(sim, striker, { x: 0, y: 0 })
    expect(t.x * dir).toBeLessThanOrEqual(10)
  })

  test('a striker level with the line, with a free carrier, runs in behind', () => {
    const sim = emptyPitch()
    const { dir, carrier } = attack(sim, 20)
    const striker = sim.teams[0][9]
    place(sim, striker, 19.5 * dir, 2)
    revealAll(sim)
    for (let i = 0; i < 40 && sim.c.Intent.kind[striker] !== IntentKind.Run; i++) decideSupport(sim, striker, carrier)
    expect(sim.c.Intent.kind[striker]).toBe(IntentKind.Run)
    expect(sim.c.Intent.x[striker] * dir).toBeGreaterThan(28)
  })

  test('a tightly marked forward comes short towards the ball', () => {
    const sim = emptyPitch()
    const { dir, carrier } = attack(sim, 30)
    const striker = sim.teams[0][9]
    place(sim, striker, 22 * dir, 5)
    place(sim, sim.teams[1][6], 23 * dir, 5)
    revealAll(sim)
    decideSupport(sim, striker, carrier)
    expect(sim.c.Intent.kind[striker]).toBe(IntentKind.Run)
    expect(Math.abs(sim.c.Intent.x[striker])).toBeLessThan(15)
  })
})

describe('without the ball', () => {
  test('the back line holds one height', () => {
    const sim = emptyPitch()
    attack(sim, 20)
    revealAll(sim)
    updateScratch(sim)
    updateTeamShape(sim)
    const backs = sim.teams[1].filter((e) => ['CB', 'WB'].includes(roleOf(sim, e)))
    const xs = backs.map((e) => openPlayTarget(sim, e, { x: 0, y: 0 }).x)
    for (const x of xs) expect(x).toBeCloseTo(xs[0], 5)
  })

  test('a teammate covers the slot of a centre-back pulled out wide', () => {
    const sim = emptyPitch()
    attack(sim, 20)
    const cb = sim.teams[1][2]
    revealAll(sim)
    updateScratch(sim)
    updateTeamShape(sim)
    const shape = shapeTarget(sim, cb, { x: 0, y: 0 })
    place(sim, cb, shape.x, shape.y + 25)
    setIntent(sim, cb, IntentKind.Press, sim.teams[0][6])
    // The rest of the team in their positions.
    for (const e of sim.teams[1]) {
      if (e === cb) continue
      const t = openPlayTarget(sim, e, { x: 0, y: 0 })
      place(sim, e, t.x, t.y)
      setIntent(sim, e, IntentKind.Hold)
    }
    revealAll(sim)
    updateScratch(sim)
    updateTeamShape(sim)
    const coverer = sim.teams[1].find((e) => sim.scratch.cover[e] === cb)
    expect(coverer).toBeDefined()
    const t = openPlayTarget(sim, coverer!, { x: 0, y: 0 })
    expect(Math.hypot(t.x - shape.x, t.y - shape.y)).toBeLessThan(3)
  })

  test('a second defender cuts the lane to the carrier’s nearest teammate', () => {
    const sim = emptyPitch()
    const { dir } = attack(sim, 20)
    const option = sim.teams[0][7]
    place(sim, option, 8 * dir, 10)
    place(sim, sim.teams[1][6], 12 * dir, 12)
    revealAll(sim)
    updateScratch(sim)
    updateTeamShape(sim)
    expect(sim.scratch.laneOption[1]).toBe(option)
    expect(sim.scratch.laneCutter[1]).toBeGreaterThan(-1)
    expect(sim.scratch.laneCutter[1]).not.toBe(sim.scratch.presser[1])
  })
})

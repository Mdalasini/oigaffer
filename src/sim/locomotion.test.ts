import { describe, expect, test } from 'bun:test'
import { kick } from './actions'
import { TICK_RATE } from './constants'
import { newMatch } from './match'
import { revealAll } from './perception'
import type { Sim } from './sim'
import { Phase } from './state'
import { step } from './step'

const CFG = { seed: 1, halfMinutes: 45, formations: ['4-3-3', '3-4-3'] as [string, string] }

/** Open play with everyone parked in a far corner, so a test can place the few players it needs. */
function emptyPitch(): Sim {
  const sim = newMatch(CFG)
  sim.m.phase = Phase.Play
  const { Pos, Vel } = sim.c
  sim.players.forEach((eid, i) => {
    Pos.x[eid] = -50 + i * 0.5
    Pos.y[eid] = -33
    Vel.x[eid] = 0
    Vel.y[eid] = 0
  })
  return sim
}

describe('receiving', () => {
  test('a receiver running across a pass steps into its path instead of letting it roll by', () => {
    // From a flagged moment: a winger sprinting forward with a pass coming across them.
    const sim = emptyPitch()
    const { Pos, Vel } = sim.c
    const [passer, receiver] = [sim.teams[0][9], sim.teams[0][10]]
    Pos.x[passer] = -10.6
    Pos.y[passer] = -0.3
    Pos.x[sim.ball] = -10.1
    Pos.y[sim.ball] = 0.4
    Pos.x[receiver] = -2.7
    Pos.y[receiver] = 24.4
    Vel.x[receiver] = 6.7
    revealAll(sim)
    kick(sim, passer, 9.4, 13.3, 0, 'pass', receiver)
    let controlled = false
    for (let i = 0; i < 4 * TICK_RATE && !controlled; i++) {
      step(sim)
      controlled = sim.m.events.some((e) => e.type === 'control' && e.by === receiver)
    }
    expect(controlled).toBe(true)
  })
})

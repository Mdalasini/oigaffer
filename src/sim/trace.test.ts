import { describe, expect, test } from 'bun:test'
import { createMatch } from './match'
import { clock, describePlayers, parseClock, playerLabel } from './trace'

describe('trace', () => {
  test('match times read and write as m:ss.s', () => {
    expect(clock(59.99)).toBe('1:00.0')
    expect(clock(754.3)).toBe('12:34.3')
    expect(parseClock('12:34.3')).toBeCloseTo(754.3)
    expect(parseClock('90')).toBe(90)
    expect(() => parseClock('soon')).toThrow()
  })

  test('every player has their own label, and a line of their own', () => {
    const world = createMatch({ seed: 1, outfielders: 4 })
    const players = world.teams.flatMap((t) => [...t.outfielders, t.keeper])
    expect(players.map((eid) => playerLabel(world, eid))).toEqual(['R1', 'R2', 'R3', 'R4', 'RK', 'B1', 'B2', 'B3', 'B4', 'BK'])
    expect(describePlayers(world)).toHaveLength(10)
    expect(describePlayers(world, new Set(['R3', 'BK'])).map((line) => line.trim().slice(0, 2))).toEqual(['R3', 'BK'])
  })
})

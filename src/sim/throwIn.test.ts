import { describe, expect, test } from 'bun:test'
import { Position } from './components'
import { createMatch, stepMatch } from './match'
import { FULL_PITCH } from './pitch'
import { THROW_RANGE } from './playmaking'
import { hypot } from './fmath'

const RED = 0

/** A match with a throw-in to Red taken at (x, the left touchline). */
function throwIn(seed: number, x: number, outfielders = 10) {
  const world = createMatch({ outfielders, seed })
  world.restart = { kind: 'throw-in', team: RED, x, y: world.pitch.halfWidth }
  world.phase = 'stopped'
  world.phaseTime = 10
  stepMatch(world)
  return world
}

describe('a throw-in', () => {
  test('is thrown, from where it was taken, to a teammate within a throw', () => {
    for (let seed = 1; seed <= 12; seed++) {
      for (const x of [-30, 0, 15, 30]) {
        const world = throwIn(seed, x)
        const thrower = world.carrier
        expect(world.thrower).toBe(thrower)
        const bx = Position.x[world.ball]
        const by = Position.y[world.ball]
        for (let i = 0; i < 120 * 3 && !world.pass && world.phase === 'play'; i++) {
          stepMatch(world)
          // No touches, no dribbling: it stays in their hands until it's thrown.
          if (!world.pass) expect(hypot(Position.x[world.ball] - bx, Position.y[world.ball] - by)).toBeLessThan(0.01)
        }
        expect(world.pass?.from).toBe(thrower)
        expect(hypot(world.pass!.x - bx, world.pass!.y - by)).toBeLessThanOrEqual(THROW_RANGE)
        expect(world.thrower).toBe(-1)
      }
    }
  })

  test('deep in their own corner, with nobody in reach, the nearest come to get it', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const world = throwIn(seed, -FULL_PITCH.halfLength + 6)
      const thrower = world.thrower
      for (let i = 0; i < 120 * 5 && !world.pass; i++) stepMatch(world)
      expect(world.pass?.from).toBe(thrower)
    }
  })

  test('alone in a side of one, the taker plays it on as from a free kick', () => {
    const world = throwIn(1, 0, 1)
    expect(world.thrower).toBe(-1)
  })
})

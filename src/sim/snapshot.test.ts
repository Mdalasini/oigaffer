import { describe, expect, test } from 'bun:test'
import { createMatch, stepMatch, type Match } from './match'
import { ticksAt } from './replay'
import { restoreState, saveState } from './snapshot'
import { stateHash } from './state'

const run = (world: Match, seconds: number) => {
  for (let i = 0; i < ticksAt(seconds); i++) stepMatch(world)
}

describe('saved states', () => {
  // The game rewinds the live match by restoring a saved state and plays on
  // from it, so a restored match must go on exactly as the original did, or
  // the game would drift from the seed and inputs it records.
  test('a restored match plays on exactly as it did the first time', () => {
    for (const seed of [1, 2, 3]) {
      const world = createMatch({ seed })
      // Every few seconds over a long spell, so slides, restarts, passes and shots in flight all get saved somewhere.
      for (let n = 0; n < 40; n++) {
        run(world, 7)
        const saved = saveState(world)
        const hashes: string[] = []
        for (let s = 0; s < 6; s++) {
          run(world, 0.5)
          hashes.push(stateHash(world))
        }
        restoreState(world, saved)
        for (let s = 0; s < 6; s++) {
          run(world, 0.5)
          expect(stateHash(world)).toBe(hashes[s])
        }
      }
    }
  })

  test('restoring undoes everything since, even across a restart', () => {
    const world = createMatch({ seed: 5 })
    run(world, 20)
    const saved = saveState(world)
    const before = stateHash(world)
    run(world, 120)
    restoreState(world, saved)
    expect(stateHash(world)).toBe(before)
  })
})

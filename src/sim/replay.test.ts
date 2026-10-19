import { describe, expect, test } from 'bun:test'
import { createMatch, stepMatch } from './match'
import { decodeFlag, encodeFlag, playBack, ticksAt, type Flag, type Replay } from './replay'
import { COMPONENTS, stateHash } from './state'
import { getAllEntities, hasComponent } from 'bitecs'
import { Offside } from './components'

/** The state hash once a second for `seconds` of `replay`. */
function fingerprints(replay: Replay, seconds: number): string[] {
  const hashes: string[] = []
  const every = ticksAt(1)
  playBack(replay, (world, tick) => {
    if (tick % every === 0) hashes.push(stateHash(world))
    return tick < ticksAt(seconds)
  })
  return hashes
}

describe('replay', () => {
  // A replay is only as good as the sim's determinism: any stray Math.random,
  // clock read or state left over between matches breaks it, and this catches it.
  test('the same seed and inputs play the same match, step for step', () => {
    for (const seed of [1, 7]) {
      const replay: Replay = { seed, outfielders: 4, inputs: [] }
      const first = fingerprints(replay, 90)
      // Another match in between, sharing the component stores, with more players than this one.
      const other = createMatch({ seed: seed + 100, outfielders: 10 })
      for (let i = 0; i < ticksAt(30); i++) stepMatch(other)
      expect(fingerprints(replay, 90)).toEqual(first)
    }
  })

  test('a new match starts clean, whatever an earlier one left in the shared stores', () => {
    const big = createMatch({ seed: 2, outfielders: 10 })
    for (let eid = 0; eid < 64; eid++) Offside.flagged[eid] = 1
    for (let i = 0; i < ticksAt(5); i++) stepMatch(big)
    const world = createMatch({ seed: 1, outfielders: 4 })
    const dirty: string[] = []
    for (const eid of getAllEntities(world)) {
      for (const [name, store] of COMPONENTS) {
        if (hasComponent(world, eid, store)) continue
        for (const [field, values] of Object.entries(store)) if ((values as Float32Array)[eid] !== 0) dirty.push(`${name}.${field}[${eid}]`)
      }
    }
    expect(dirty).toEqual([])
  })

  test('inputs change the match, and replay the same each time', () => {
    const plain: Replay = { seed: 3, outfielders: 4, inputs: [] }
    const nudged: Replay = {
      seed: 3,
      outfielders: 4,
      inputs: [
        { tick: ticksAt(5), kind: 'grade', team: 'red', role: 'outfielder', key: 'pace', grade: 20 },
        { tick: ticksAt(20), kind: 'shoot' },
        { tick: ticksAt(40), kind: 'reset' },
      ],
    }
    const once = fingerprints(nudged, 60)
    expect(fingerprints(nudged, 60)).toEqual(once)
    expect(fingerprints(plain, 60).at(-1)).not.toBe(once.at(-1))
  })

  test('a flag survives being copied as text', () => {
    const flag: Flag = { seed: 1729, outfielders: 4, inputs: [{ tick: 9, kind: 'shoot' }], from: 100, to: 400, note: 'the left back stops – “why?”' }
    expect(decodeFlag(encodeFlag(flag))).toEqual(flag)
    expect(() => decodeFlag('hello')).toThrow()
  })
})

describe('decisions', () => {
  test('reading decisions back never changes the match', () => {
    const replay: Replay = { seed: 11, outfielders: 4, inputs: [] }
    const quiet = fingerprints(replay, 60)
    const said = new Map<number, number>()
    const hashes: string[] = []
    const match = playBack(replay, (world, tick) => {
      world.onDecision ??= (player) => said.set(player, (said.get(player) ?? 0) + 1)
      if (tick % ticksAt(1) === 0) hashes.push(stateHash(world))
      return tick < ticksAt(60)
    })
    expect(hashes).toEqual(quiet)
    // Every outfielder had something to say.
    for (const team of match.teams) for (const eid of team.outfielders) expect(said.get(eid)).toBeGreaterThan(0)
  })
})

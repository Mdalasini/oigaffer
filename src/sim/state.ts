import { getAllEntities, hasComponent } from 'bitecs'
import * as Components from './components'
import type { Match } from './match'

type Store = Record<string, ArrayBufferView>

/**
 * Every component in the sim: data components (all fields typed arrays) and
 * tags (no fields). The enums that share `components.ts` hold numbers, so
 * they aren't picked up.
 */
export const COMPONENTS: readonly (readonly [string, Store])[] = Object.entries(Components)
  .filter(([, value]) => typeof value === 'object' && Object.values(value).every((field) => ArrayBuffer.isView(field)))
  .map(([name, value]) => [name, value as Store] as const)

/**
 * A fingerprint of everything that decides how the match goes on from here:
 * every component's data and membership, the random number state and the
 * match context. Two matches with the same hash play the same from now on.
 */
export function stateHash(world: Match): string {
  let h = 0x811c9dc5
  const bytes = (view: ArrayBufferView) => {
    const b = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193)
  }
  const text = (s: string) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  }
  const entities = getAllEntities(world)
  for (const [name, store] of COMPONENTS) {
    text(name)
    for (const eid of entities) text(hasComponent(world, eid, store) ? '1' : '0')
    for (const field of Object.values(store)) bytes(field)
  }
  text(String(world.rng.state))
  for (const [key, value] of Object.entries(world)) {
    if (typeof value === 'function') continue
    text(key)
    if (key === 'memory') for (const field of Object.values(world.memory)) ArrayBuffer.isView(field) ? bytes(field) : text(JSON.stringify(field))
    else text(JSON.stringify(value))
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

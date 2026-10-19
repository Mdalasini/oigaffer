import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import type { Match, MatchContext } from './match'
import { COMPONENTS } from './state'

/**
 * A match frozen at one moment: every component's data and who has it, the
 * random number state, and the match context. Restoring it into the same
 * match puts it back exactly, so it plays on from there as it did the first
 * time.
 */
export interface SavedState {
  fields: ArrayBufferView[]
  members: number[][]
  rng: number
  context: Partial<MatchContext>
}

/** Context that never changes during a match, or that belongs to whoever is watching it, not to the match. */
const KEPT: ReadonlySet<string> = new Set(['rng', 'pitch', 'teams', 'onEvent', 'onCue'])

const copy = (view: ArrayBufferView) => (view as Float32Array).slice()

export function saveState(world: Match): SavedState {
  const context: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(world)) if (!KEPT.has(key)) context[key] = structuredClone(value)
  return {
    fields: COMPONENTS.flatMap(([, store]) => Object.values(store).map(copy)),
    members: COMPONENTS.map(([, store]) => [...query(world, [store])]),
    rng: world.rng.state,
    context: context as Partial<MatchContext>,
  }
}

export function restoreState(world: Match, saved: SavedState) {
  let field = 0
  COMPONENTS.forEach(([, store], i) => {
    // Only tags like OnBall and Sliding come and go during a match, and the
    // systems that query them don't depend on the order they're visited in.
    const members = new Set(saved.members[i])
    for (const eid of [...query(world, [store])]) if (!members.has(eid)) removeComponent(world, eid, store)
    for (const eid of saved.members[i]) if (!hasComponent(world, eid, store)) addComponent(world, eid, store)
    for (const values of Object.values(store)) (values as Float32Array).set(saved.fields[field++] as Float32Array)
  })
  world.rng.state = saved.rng
  for (const [key, value] of Object.entries(saved.context)) (world as unknown as Record<string, unknown>)[key] = structuredClone(value)
}

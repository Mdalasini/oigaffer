// Whole-sim snapshots. Entities never change during a match, so a snapshot is
// every component array plus the JSON match state; restoring one and stepping
// reproduces the original run exactly.

import { componentArrays } from './components'
import { syncRoster, type Sim } from './sim'
import type { MatchConfig, MatchState } from './state'

export interface Snapshot {
  /** The config the snapshot's sim was built with; restoring needs a sim built the same way. */
  cfg: MatchConfig
  arrays: number[][]
  m: MatchState
}

export function snapshot(sim: Sim): Snapshot {
  return {
    cfg: structuredClone(sim.cfg),
    arrays: componentArrays(sim.c).map((a) => Array.from(a)),
    m: structuredClone(sim.m),
  }
}

export function restore(sim: Sim, snap: Snapshot): void {
  if (JSON.stringify(sim.cfg) !== JSON.stringify(snap.cfg)) {
    throw new Error(`snapshot is for config ${JSON.stringify(snap.cfg)}, sim has ${JSON.stringify(sim.cfg)}`)
  }
  const arrays = componentArrays(sim.c)
  if (snap.arrays.length !== arrays.length || snap.arrays.some((a, i) => a.length !== arrays[i].length)) {
    throw new Error('snapshot was taken with a different set of components')
  }
  arrays.forEach((a, i) => a.set(snap.arrays[i]))
  sim.m = structuredClone(snap.m)
  syncRoster(sim)
}

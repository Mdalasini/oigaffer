// Whole-sim snapshots. Entities never change during a match, so a snapshot is
// every component array plus the JSON match state; restoring one and stepping
// reproduces the original run exactly.

import { componentArrays } from './components'
import type { Sim } from './sim'
import type { MatchState } from './state'

export interface Snapshot {
  arrays: number[][]
  m: MatchState
}

export function snapshot(sim: Sim): Snapshot {
  return {
    arrays: componentArrays(sim.c).map((a) => Array.from(a)),
    m: structuredClone(sim.m),
  }
}

export function restore(sim: Sim, snap: Snapshot): void {
  componentArrays(sim.c).forEach((a, i) => a.set(snap.arrays[i]))
  sim.m = structuredClone(snap.m)
}

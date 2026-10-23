import { intentSystem, thinkSystem, updateScratch } from './brain'
import { matchSystem } from './match'
import type { Sim } from './sim'
import { Phase } from './state'
import { ballSystem } from './systems/ball'
import { locomotionSystem, separationSystem } from './systems/locomotion'
import { possessionSystem } from './systems/possession'

/** Advances the match by one fixed tick. */
export function step(sim: Sim): void {
  const m = sim.m
  if (m.phase === Phase.FullTime) return
  m.events = []
  m.tick++
  matchSystem(sim)
  updateScratch(sim)
  thinkSystem(sim)
  intentSystem(sim)
  locomotionSystem(sim)
  separationSystem(sim)
  ballSystem(sim)
  possessionSystem(sim)
}

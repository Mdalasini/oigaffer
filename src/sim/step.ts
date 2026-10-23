import { thinkSystem, updateScratch } from './brain'
import { intentSystem } from './execute'
import { keeperSystem } from './keeper'
import { matchSystem } from './match'
import { updateTeamShape } from './offball'
import { perceptionSystem } from './perception'
import { refereeSystem } from './referee'
import type { Sim } from './sim'
import { Phase } from './state'
import { ballSystem } from './systems/ball'
import { locomotionSystem, separationSystem } from './systems/locomotion'
import { possessionSystem } from './systems/possession'

/** Advances the match by one fixed tick. */
export function step(sim: Sim): void {
  const m = sim.m
  if (m.phase === Phase.FullTime) return
  m.prevEvents = m.events
  m.events = []
  m.tick++
  matchSystem(sim)
  perceptionSystem(sim)
  updateScratch(sim)
  updateTeamShape(sim)
  thinkSystem(sim)
  intentSystem(sim)
  locomotionSystem(sim)
  separationSystem(sim)
  ballSystem(sim)
  possessionSystem(sim)
  refereeSystem(sim)
  // Last, so keepers see every shot and header struck this tick.
  keeperSystem(sim)
}

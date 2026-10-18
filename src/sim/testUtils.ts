import { GOAL_X } from './constants'
import type { Match } from './match'

/** Puts a Red shot at the +x goal in flight, as far as the rules for settling it care. */
export function shotUnderway(world: Match) {
  world.shot = { team: 0, goalX: GOAL_X, origin: { x: 0, y: 0, z: 0 }, aim: { y: 0, z: 1 }, radius: 1, target: { y: 0, z: 1 }, crossing: null }
  world.phase = 'shot'
}

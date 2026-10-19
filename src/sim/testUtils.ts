import type { Match } from './match'
import type { Rng } from './rng'

/** Puts a Red shot at the +x goal in flight, as far as the rules for settling it care. */
export function shotUnderway(world: Match) {
  world.shot = { team: 0, goalX: world.pitch.halfLength, origin: { x: 0, y: 0, z: 0 }, aim: { y: 0, z: 1 }, radius: 1, target: { y: 0, z: 1 }, crossing: null }
  world.phase = 'shot'
}

/** A stand-in random source that hands out whatever `next` returns. */
export const stubRng = (next: () => number): Rng => Object.assign(next, { state: 0 })

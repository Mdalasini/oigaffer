import { CONTROL_HEIGHT, DT, FOOT_REACH } from './constants'
import type { BallState } from './ballmotion'
import { age, lastSeenBall } from './perception'
import { PATH_SAMPLES, PATH_STRIDE, predictPath } from './scratch'
import type { Sim } from './sim'

export function topSpeed(sim: Sim, eid: number): number {
  return 6.6 + 2.6 * sim.c.Attr.pace[eid]
}

export function acceleration(sim: Sim, eid: number): number {
  // A diving keeper launches sideways far faster than anyone can run.
  if (sim.m.tick < sim.c.Keeper.diveUntil[eid]) return 14 + 6 * sim.c.Attr.keeping[eid]
  // So does a player lunging into a slide.
  if (sim.m.tick < sim.c.Body.lungeUntil[eid]) return 10
  return 3 + 2.5 * sim.c.Attr.accel[eid]
}

export const BRAKING = 6.5

/** Seconds for a player starting at `v0` m/s to cover `dist` metres flat out. */
export function runTime(dist: number, v0: number, vmax: number, accel: number): number {
  if (dist <= 0) return 0
  v0 = Math.min(v0, vmax)
  const tAccel = (vmax - v0) / accel
  const dAccel = (v0 + vmax) * 0.5 * tAccel
  if (dist >= dAccel) return tAccel + (dist - dAccel) / vmax
  return (Math.sqrt(v0 * v0 + 2 * accel * dist) - v0) / accel
}

export interface Intercept {
  t: number
  x: number
  y: number
}

const believedPath = new Float64Array(PATH_SAMPLES * 3)
const lastSeen: BallState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
const staleShift = new Float64Array(PATH_SAMPLES * 3)

/**
 * The ball path as the player believes it: the shared prediction when they
 * can see the ball, otherwise one flown on from their last sighting.
 */
function pathFor(sim: Sim, eid: number): Float64Array {
  const stale = Math.round(age(sim, eid, sim.ball) / DT)
  if (stale === 0) return sim.scratch.path
  // Fly the last sighting forward by its age so sample 0 is "now" as they imagine it.
  predictPath(staleShift, lastSeenBall(sim, eid, lastSeen))
  const skip = Math.min(PATH_SAMPLES - 1, Math.round(stale / PATH_STRIDE))
  for (let s = 0; s < PATH_SAMPLES; s++) {
    const from = Math.min(PATH_SAMPLES - 1, s + skip) * 3
    believedPath[s * 3] = staleShift[from]
    believedPath[s * 3 + 1] = staleShift[from + 1]
    believedPath[s * 3 + 2] = staleShift[from + 2]
  }
  return believedPath
}

/**
 * Earliest point on the ball path (as the player believes it) they can reach
 * in time, or the end of the path if they cannot catch it.
 */
export function intercept(sim: Sim, eid: number, out: Intercept, reaction = 0.2, maxHeight = CONTROL_HEIGHT): Intercept {
  const { Pos, Vel } = sim.c
  const path = pathFor(sim, eid)
  const px = Pos.x[eid]
  const py = Pos.y[eid]
  const v0 = Math.sqrt(Vel.x[eid] * Vel.x[eid] + Vel.y[eid] * Vel.y[eid])
  const vmax = topSpeed(sim, eid)
  const acc = acceleration(sim, eid)
  for (let s = 0; s < PATH_SAMPLES; s++) {
    const bx = path[s * 3]
    const by = path[s * 3 + 1]
    if (path[s * 3 + 2] > maxHeight) continue
    const t = s * PATH_STRIDE * DT
    const dist = Math.sqrt((bx - px) * (bx - px) + (by - py) * (by - py)) - FOOT_REACH
    if (reaction + runTime(dist, v0 * 0.5, vmax, acc) <= t) {
      out.t = t
      out.x = bx
      out.y = by
      return out
    }
  }
  const last = (PATH_SAMPLES - 1) * 3
  out.t = Infinity
  out.x = path[last]
  out.y = path[last + 1]
  return out
}

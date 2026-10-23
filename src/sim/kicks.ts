// Kick planning: the launch velocity that sends the ball where it should go,
// and the flight it will then take, using the same integrator as the live ball.

import { groundKickSpeed, integrateBall, type BallState } from './ballmotion'
import { GRAVITY } from './constants'

/** Samples of a planned flight: one every FLIGHT_STRIDE ticks. */
export const FLIGHT_STRIDE = 3
export const FLIGHT_SAMPLES = 40

export interface Flight {
  /** x, y, z per sample; sample 0 is the launch point. */
  xyz: Float64Array
  count: number
}

export function createFlight(): Flight {
  return { xyz: new Float64Array(FLIGHT_SAMPLES * 3), count: 0 }
}

export function simulateFlight(out: Flight, x: number, y: number, vx: number, vy: number, vz: number): Flight {
  const b: BallState = { x, y, z: 0, vx, vy, vz }
  out.count = 0
  for (let s = 0; s < FLIGHT_SAMPLES; s++) {
    out.xyz[s * 3] = b.x
    out.xyz[s * 3 + 1] = b.y
    out.xyz[s * 3 + 2] = b.z
    out.count++
    if (b.vx === 0 && b.vy === 0 && b.z === 0 && b.vz === 0) break
    for (let i = 0; i < FLIGHT_STRIDE; i++) integrateBall(b)
  }
  return out
}

/** Horizontal distance a ball launched at (vh, vz) travels before first landing. */
function carry(vh: number, vz: number): number {
  const b: BallState = { x: 0, y: 0, z: 0, vx: vh, vy: 0, vz }
  for (let i = 0; i < 600; i++) {
    integrateBall(b)
    if (b.z === 0) return b.x
  }
  return b.x
}

/** Launch speeds for a ball that peaks around `apex` metres and first lands `distance` metres away. */
export function airKick(distance: number, apex: number): { vh: number; vz: number } {
  const vz = Math.sqrt(2 * GRAVITY * apex) * 1.04
  let lo = 0
  let hi = 40
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2
    if (carry(mid, vz) < distance) lo = mid
    else hi = mid
  }
  return { vh: hi, vz }
}

export { groundKickSpeed }

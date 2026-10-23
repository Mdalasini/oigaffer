// Ball flight and roll, one tick at a time. The same integrator drives the
// live ball, path prediction and kick planning, so a planned pass arrives
// exactly where the planner expected.

import {
  AIR_DRAG,
  BOUNCE_FRICTION,
  BOUNCE_RESTITUTION,
  BOUNCE_SETTLE,
  DT,
  GRAVITY,
  ROLL_DECEL,
  ROLL_DRAG,
} from './constants'

export interface BallState {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

export function integrateBall(b: BallState): void {
  if (b.z > 0 || b.vz > 0) {
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz)
    const drag = AIR_DRAG * speed * DT
    b.vx -= drag * b.vx
    b.vy -= drag * b.vy
    b.vz -= drag * b.vz + GRAVITY * DT
    b.x += b.vx * DT
    b.y += b.vy * DT
    b.z += b.vz * DT
    if (b.z <= 0) {
      b.z = 0
      if (b.vz < -BOUNCE_SETTLE) {
        b.vz = -b.vz * BOUNCE_RESTITUTION
        b.vx *= BOUNCE_FRICTION
        b.vy *= BOUNCE_FRICTION
      } else {
        b.vz = 0
      }
    }
    return
  }
  const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy)
  if (speed === 0) return
  b.x += b.vx * DT
  b.y += b.vy * DT
  const slowed = speed * (1 - ROLL_DRAG * DT) - ROLL_DECEL * DT
  const k = slowed > 0.02 ? slowed / speed : 0
  b.vx *= k
  b.vy *= k
}

/** Distance a ground ball kicked at `v0` rolls before slowing to `arrive` m/s. */
export function rollDistance(v0: number, arrive: number): number {
  const b: BallState = { x: 0, y: 0, z: 0, vx: v0, vy: 0, vz: 0 }
  for (let i = 0; i < 2000 && b.vx > arrive; i++) integrateBall(b)
  return b.x
}

/** Kick speed for a ground ball that is still moving at `arrive` m/s after `distance` metres. */
export function groundKickSpeed(distance: number, arrive: number): number {
  let lo = arrive
  let hi = 40
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (rollDistance(mid, arrive) < distance) lo = mid
    else hi = mid
  }
  return hi
}

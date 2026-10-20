import { Position, Velocity } from './components'
import { BALL_GRIP, BALL_RADIUS, BALL_RESTITUTION, BALL_ROLLING_SHARE, GRAVITY } from './constants'
import type { Match } from './match'

/**
 * A lofted pass climbs to LOFT_APEX_BASE plus LOFT_APEX_PER_METRE of its
 * length, between these limits (m): high enough to clear the heads of
 * anyone it passes over, not so high it hangs for ever. Its flight time
 * follows from that.
 */
const LOFT_APEX_BASE = 1.5
const LOFT_APEX_PER_METRE = 0.12
const LOFT_APEX_MIN = 3
const LOFT_APEX_MAX = 8

/** Seconds a lofted pass `distance` metres long spends in the air, from strike to landing. */
export function loftFlightTime(distance: number): number {
  const apex = Math.min(LOFT_APEX_MAX, Math.max(LOFT_APEX_MIN, LOFT_APEX_BASE + LOFT_APEX_PER_METRE * distance))
  return Math.sqrt((8 * apex) / GRAVITY)
}

/** Upward speed (m/s) that keeps a ball struck from the ground in the air for `flight` seconds. */
export const launchUp = (flight: number) => (GRAVITY * flight) / 2

/** Height (m) of a ball struck upward at `up` m/s, `t` seconds after it was struck. */
export const heightAt = (up: number, t: number) => BALL_RADIUS + up * t - (GRAVITY * t * t) / 2

/**
 * Pace over the ground (m/s) kept by a ball moving at `ground` m/s that
 * comes down at `down` m/s and bounces: the turf grips it, taking more the
 * harder it comes down, until it's rolling.
 */
export function afterBounce(ground: number, down: number): number {
  if (ground <= 0) return 0
  return ground * Math.max(BALL_ROLLING_SHARE, 1 - (BALL_GRIP * (1 + BALL_RESTITUTION) * down) / ground)
}

/** Players going for a ball in the air make for where it comes down to this height (m): low enough to jump for. */
export const MEET_HEIGHT = 2.2

/** Below this upward speed (m/s), a ball on the ground is rolling, not bouncing. */
const ROLLING = 1

/** Whether the ball is in the air: off the ground, or bouncing up off it. */
export function airborne(world: Match): boolean {
  const ball = world.ball
  return Position.z[ball] > BALL_RADIUS + 0.01 || Velocity.z[ball] > ROLLING
}

/**
 * Where, and in how many seconds, the ball in the air next comes down to
 * `height` metres; with `height` above the top of its flight, where it
 * comes down to the ground. Null if it's rolling along the ground.
 */
export function dropPoint(world: Match, height = BALL_RADIUS): { x: number; y: number; t: number } | null {
  if (!airborne(world)) return null
  const ball = world.ball
  const z = Position.z[ball]
  const vz = Velocity.z[ball]
  let disc = vz * vz + 2 * GRAVITY * (z - height)
  if (disc < 0) disc = vz * vz + 2 * GRAVITY * (z - BALL_RADIUS)
  const t = Math.max(0, (vz + Math.sqrt(Math.max(0, disc))) / GRAVITY)
  return { x: Position.x[ball] + Velocity.x[ball] * t, y: Position.y[ball] + Velocity.y[ball] * t, t }
}

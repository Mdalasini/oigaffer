import { BALL_RADIUS, GOAL_HALF_WIDTH, GRAVITY } from './constants'
import type { Rng } from './rng'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** A point on a goal plane: across the goal (y) and up (z). */
export interface GoalPoint {
  y: number
  z: number
}

/** How far inside the post a shooter aims. */
const AIM_POST_MARGIN = 0.6
const AIM_LOW_Z = 0.35
const AIM_HIGH_Z = 1.85

/**
 * Picks the corner with the most space around the keeper. With the keeper
 * dead centre, the shooter goes across goal to the far post.
 */
export function chooseAim(ballY: number, keeperY: number, high: boolean): GoalPoint {
  let side: number
  if (Math.abs(keeperY) > 0.05) side = -Math.sign(keeperY)
  else side = ballY === 0 ? 1 : -Math.sign(ballY)
  return { y: side * (GOAL_HALF_WIDTH - AIM_POST_MARGIN), z: high ? AIM_HIGH_Z : AIM_LOW_Z }
}

/** Uniformly samples a point inside the circle of `radius` around `aim`. */
export function sampleShotTarget(rng: Rng, aim: GoalPoint, radius: number): GoalPoint {
  const r = radius * Math.sqrt(rng())
  const theta = rng() * Math.PI * 2
  return {
    y: aim.y + r * Math.cos(theta),
    z: Math.max(BALL_RADIUS, aim.z + r * Math.sin(theta)),
  }
}

/**
 * Velocity that carries a ball from `from` through `target` on the goal plane
 * x = `goalX`, travelling at `speed` along the ground, under gravity and
 * without drag.
 */
export function launchVelocity(from: Vec3, target: GoalPoint, speed: number, goalX: number): Vec3 {
  const dx = goalX - from.x
  const dy = target.y - from.y
  const ground = Math.hypot(dx, dy)
  const t = ground / speed
  return {
    x: (dx / ground) * speed,
    y: (dy / ground) * speed,
    z: (target.z - from.z + 0.5 * GRAVITY * t * t) / t,
  }
}

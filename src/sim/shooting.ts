import { BALL_RADIUS, GOAL_HALF_WIDTH, GRAVITY } from './constants'
import { gaussian, type Rng } from './rng'
import { hypot } from './fmath'

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

/**
 * How far inside the post a shooter aims: at least AIM_POST_MARGIN, and
 * further in the more they expect to miss by, so a long or hurried shot is
 * aimed safer. Never nearer the middle than AIM_MID_MARGIN from it.
 */
const AIM_POST_MARGIN = 0.5
const AIM_MID_MARGIN = 0.5
/** Share of their expected miss a shooter aims inside the post by: they still go for the corner, and some go wide. */
const AIM_MISS_SHARE = 0.5
const AIM_LOW_Z = 0.35
const AIM_HIGH_Z = 1.85
/** Shots go off line upwards and downwards a little less than sideways. */
export const VERTICAL_ERROR = 0.7

/**
 * Picks the corner with the most space around the keeper: with the keeper
 * dead centre, across goal to the far post. `miss` is the standard deviation
 * (m) of where the shot will land around the aim, which sets how far inside
 * the post to go.
 */
export function chooseAim(ballY: number, keeperY: number, high: boolean, miss = 0): GoalPoint {
  let side: number
  if (Math.abs(keeperY) > 0.05) side = -Math.sign(keeperY)
  else side = ballY === 0 ? 1 : -Math.sign(ballY)
  const margin = Math.min(GOAL_HALF_WIDTH - AIM_MID_MARGIN, Math.max(AIM_POST_MARGIN, AIM_MISS_SHARE * miss))
  return { y: side * (GOAL_HALF_WIDTH - margin), z: high ? AIM_HIGH_Z : AIM_LOW_Z }
}

/** Samples where a shot aimed at `aim` lands, off by a normal error of standard deviation `miss` (m). */
export function sampleShotTarget(rng: Rng, aim: GoalPoint, miss: number): GoalPoint {
  return {
    y: aim.y + gaussian(rng) * miss,
    z: Math.max(BALL_RADIUS, aim.z + gaussian(rng) * miss * VERTICAL_ERROR),
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
  const ground = hypot(dx, dy)
  const t = ground / speed
  return {
    x: (dx / ground) * speed,
    y: (dy / ground) * speed,
    z: (target.z - from.z + 0.5 * GRAVITY * t * t) / t,
  }
}

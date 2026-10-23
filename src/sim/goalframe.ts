// Posts and crossbar. The ball can travel a metre a tick, so contact is found
// at the first point along the tick's path where it touches the frame.

import type { BallState } from './ballmotion'
import { BALL_RADIUS } from './constants'
import { GOAL_HEIGHT, GOAL_WIDTH, HALF_LENGTH } from './pitch'

const POST_RADIUS = 0.06
const HIT = POST_RADIUS + BALL_RADIUS
const RESTITUTION = 0.6

/** Bounces the ball off a post or the bar if its move this tick hit one; returns true on contact. */
export function collideGoalFrame(fromX: number, fromY: number, fromZ: number, b: BallState): boolean {
  for (const gx of [-HALF_LENGTH, HALF_LENGTH]) {
    for (const py of [-GOAL_WIDTH / 2, GOAL_WIDTH / 2]) {
      if (b.z <= GOAL_HEIGHT && bounce(fromX, fromY, b, 'y', gx, py)) return true
    }
    if (Math.abs(b.y) <= GOAL_WIDTH / 2 && bounce(fromX, fromZ, b, 'z', gx, GOAL_HEIGHT)) return true
  }
  return false
}

/**
 * Circle-vs-moving-point in the plane of x and `axis` (y for a post, z for
 * the bar): finds the first fraction of the move at which the ball is HIT
 * from the frame's centre (px, pv), and reflects off the normal there.
 */
function bounce(fromX: number, fromV: number, b: BallState, axis: 'y' | 'z', px: number, pv: number): boolean {
  const vAxis = axis === 'y' ? 'vy' : 'vz'
  const sx = b.x - fromX
  const sv = b[axis] - fromV
  const ox = fromX - px
  const ov = fromV - pv
  const a = sx * sx + sv * sv
  const c = ox * ox + ov * ov - HIT * HIT
  let t: number
  if (c <= 0) t = 0
  else {
    if (a === 0) return false
    const half = ox * sx + ov * sv
    const disc = half * half - a * c
    if (half >= 0 || disc < 0) return false
    t = (-half - Math.sqrt(disc)) / a
    if (t > 1) return false
  }
  const cx = fromX + sx * t
  const cv = fromV + sv * t
  const nx = cx - px
  const nv = cv - pv
  const nl = Math.sqrt(nx * nx + nv * nv)
  const speed = Math.sqrt(b.vx * b.vx + b[vAxis] * b[vAxis]) || 1
  const ux = nl > 0 ? nx / nl : -b.vx / speed
  const uv = nl > 0 ? nv / nl : -b[vAxis] / speed
  const vn = b.vx * ux + b[vAxis] * uv
  if (vn >= 0) return false
  b.x = px + ux * HIT
  b[axis] = pv + uv * HIT
  b.vx -= (1 + RESTITUTION) * vn * ux
  b[vAxis] -= (1 + RESTITUTION) * vn * uv
  return true
}

// Posts and crossbar. The ball can travel a metre a tick, so contact is found
// along the tick's whole path rather than at its end.

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
      if (hitPost(fromX, fromY, b, gx, py)) return true
    }
    if (hitBar(fromX, fromZ, b, gx)) return true
  }
  return false
}

function hitPost(fromX: number, fromY: number, b: BallState, px: number, py: number): boolean {
  if (b.z > GOAL_HEIGHT) return false
  // Closest approach of this tick's path to the post.
  const sx = b.x - fromX
  const sy = b.y - fromY
  const len2 = sx * sx + sy * sy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - fromX) * sx + (py - fromY) * sy) / len2)) : 1
  const cx = fromX + sx * t
  const cy = fromY + sy * t
  const nx = cx - px
  const ny = cy - py
  const d = Math.sqrt(nx * nx + ny * ny)
  if (d >= HIT) return false
  // Dead centre on the post: it comes straight back.
  const vl = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1
  const ux = d > 0 ? nx / d : -b.vx / vl
  const uy = d > 0 ? ny / d : -b.vy / vl
  const vn = b.vx * ux + b.vy * uy
  if (vn >= 0) return false
  b.x = px + ux * HIT
  b.y = py + uy * HIT
  b.vx -= (1 + RESTITUTION) * vn * ux
  b.vy -= (1 + RESTITUTION) * vn * uy
  return true
}

function hitBar(fromX: number, fromZ: number, b: BallState, gx: number): boolean {
  if (Math.abs(b.y) > GOAL_WIDTH / 2) return false
  const sx = b.x - fromX
  const sz = b.z - fromZ
  const len2 = sx * sx + sz * sz
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((gx - fromX) * sx + (GOAL_HEIGHT - fromZ) * sz) / len2)) : 1
  const nx = fromX + sx * t - gx
  const nz = fromZ + sz * t - GOAL_HEIGHT
  const d = Math.sqrt(nx * nx + nz * nz)
  if (d >= HIT) return false
  const vl = Math.sqrt(b.vx * b.vx + b.vz * b.vz) || 1
  const ux = d > 0 ? nx / d : -b.vx / vl
  const uz = d > 0 ? nz / d : -b.vz / vl
  const vn = b.vx * ux + b.vz * uz
  if (vn >= 0) return false
  b.x = gx + ux * HIT
  b.z = GOAL_HEIGHT + uz * HIT
  b.vx -= (1 + RESTITUTION) * vn * ux
  b.vz -= (1 + RESTITUTION) * vn * uz
  return true
}

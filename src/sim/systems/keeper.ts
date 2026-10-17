import { query } from 'bitecs'
import { Facing, Goalkeeper, Position, Velocity } from '../components'
import { GOAL_HALF_WIDTH, GOAL_X } from '../constants'
import type { Match } from '../match'

/** How far off the line the keeper comes to narrow the angle. */
const ADVANCE = 1.0
const SET_SPEED = 4
const DIVE_SPEED = 6
const DIVE_ACCEL = 13
/** Furthest the keeper's centre goes beyond a post. */
const POST_OVERRUN = 0.4

export function keeperSystem(world: Match, dt: number) {
  for (const eid of query(world, [Goalkeeper, Position, Velocity, Facing])) {
    // Keepers stay square to the ball; their dives are lateral, so they move
    // outside the locomotion model.
    Facing.angle[eid] = Math.atan2(Position.y[world.ball] - Position.y[eid], Position.x[world.ball] - Position.x[eid])
    if (world.phase === 'approach') setPosition(world, eid, dt)
    else if (world.phase === 'shot') dive(world, eid, dt)
    else {
      const decay = Math.exp(-6 * dt)
      Velocity.x[eid] *= decay
      Velocity.y[eid] *= decay
    }
    Position.x[eid] += Velocity.x[eid] * dt
    Position.y[eid] += Velocity.y[eid] * dt
    const limit = GOAL_HALF_WIDTH + POST_OVERRUN
    if (Math.abs(Position.y[eid]) > limit) {
      Position.y[eid] = Math.sign(Position.y[eid]) * limit
      Velocity.y[eid] = 0
    }
  }
}

/** Stand on the line between the ball and the centre of goal. */
function setPosition(world: Match, eid: number, dt: number) {
  const ball = world.ball
  const bx = Position.x[ball] - GOAL_X
  const by = Position.y[ball]
  const len = Math.hypot(bx, by) || 1
  const tx = GOAL_X + (bx / len) * ADVANCE
  const ty = clamp((by / len) * ADVANCE * 2, -(GOAL_HALF_WIDTH - 0.5), GOAL_HALF_WIDTH - 0.5)
  const dx = tx - Position.x[eid]
  const dy = ty - Position.y[eid]
  const dist = Math.hypot(dx, dy)
  const speed = Math.min(SET_SPEED, dist / dt)
  Velocity.x[eid] = dist > 1e-4 ? (dx / dist) * speed : 0
  Velocity.y[eid] = dist > 1e-4 ? (dy / dist) * speed : 0
}

/** Frozen until the reaction delay runs out, then dive across the line. */
function dive(world: Match, eid: number, dt: number) {
  Velocity.x[eid] = 0
  if (Goalkeeper.reactTimer[eid] > 0) {
    Goalkeeper.reactTimer[eid] -= dt
    Velocity.y[eid] = 0
    return
  }
  const ball = world.ball
  const vx = Velocity.x[ball]
  const t = vx > 0 ? Math.max(0, (Position.x[eid] - Position.x[ball]) / vx) : 0
  const predictedY = Position.y[ball] + Velocity.y[ball] * t
  const desired = clamp((predictedY - Position.y[eid]) * 10, -DIVE_SPEED, DIVE_SPEED)
  const change = clamp(desired - Velocity.y[eid], -DIVE_ACCEL * dt, DIVE_ACCEL * dt)
  Velocity.y[eid] += change
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

import { query } from 'bitecs'
import { Ball, Facing, Position, Velocity } from '../components'
import {
  BALL_RADIUS,
  BALL_RESTITUTION,
  BALL_ROLLING_FRICTION,
  GOAL_DEPTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  GOAL_X,
  GRAVITY,
} from '../constants'
import type { Match } from '../match'

export function ballSystem(world: Match, dt: number) {
  for (const eid of query(world, [Ball, Position, Velocity])) {
    world.prevBall.x = Position.x[eid]
    world.prevBall.y = Position.y[eid]
    world.prevBall.z = Position.z[eid]
    if (world.phase === 'approach') {
      carry(eid, world.striker)
      continue
    }

    Velocity.z[eid] -= GRAVITY * dt
    Position.x[eid] += Velocity.x[eid] * dt
    Position.y[eid] += Velocity.y[eid] * dt
    Position.z[eid] += Velocity.z[eid] * dt

    if (Position.z[eid] <= BALL_RADIUS) {
      Position.z[eid] = BALL_RADIUS
      Velocity.z[eid] = Velocity.z[eid] < -1 ? -Velocity.z[eid] * BALL_RESTITUTION : 0
      const roll = Math.max(0, 1 - BALL_ROLLING_FRICTION * dt)
      Velocity.x[eid] *= roll
      Velocity.y[eid] *= roll
    }

    if (world.outcome === 'goal') containInNet(eid)
  }
}

/** Distance ahead of the carrier's centre that the ball sits while dribbling. */
const CARRY_OFFSET = 0.6

/** Keeps the ball at the carrier's feet, in front of where they face. */
function carry(ball: number, carrier: number) {
  const angle = Facing.angle[carrier]
  Position.x[ball] = Position.x[carrier] + Math.cos(angle) * CARRY_OFFSET
  Position.y[ball] = Position.y[carrier] + Math.sin(angle) * CARRY_OFFSET
  Position.z[ball] = BALL_RADIUS
  Velocity.x[ball] = Velocity.x[carrier]
  Velocity.y[ball] = Velocity.y[carrier]
  Velocity.z[ball] = 0
}

function containInNet(eid: number) {
  const back = GOAL_X + GOAL_DEPTH - BALL_RADIUS
  if (Position.x[eid] > back) {
    Position.x[eid] = back
    Velocity.x[eid] *= -0.1
    Velocity.y[eid] *= 0.4
    Velocity.z[eid] *= 0.4
  }
  const side = GOAL_HALF_WIDTH - BALL_RADIUS
  if (Math.abs(Position.y[eid]) > side) {
    Position.y[eid] = Math.sign(Position.y[eid]) * side
    Velocity.y[eid] *= -0.2
  }
  const roof = GOAL_HEIGHT - BALL_RADIUS
  if (Position.z[eid] > roof) {
    Position.z[eid] = roof
    Velocity.z[eid] = -Math.abs(Velocity.z[eid]) * 0.2
  }
}

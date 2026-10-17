import { query } from 'bitecs'
import { Ball, Position, Velocity } from '../components'
import {
  BALL_RADIUS,
  BALL_RESTITUTION,
  BALL_ROLL_DECEL,
  BALL_ROLL_DRAG,
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
    Velocity.z[eid] -= GRAVITY * dt
    Position.x[eid] += Velocity.x[eid] * dt
    Position.y[eid] += Velocity.y[eid] * dt
    Position.z[eid] += Velocity.z[eid] * dt

    if (Position.z[eid] <= BALL_RADIUS) {
      Position.z[eid] = BALL_RADIUS
      Velocity.z[eid] = Velocity.z[eid] < -1 ? -Velocity.z[eid] * BALL_RESTITUTION : 0
      const speed = Math.hypot(Velocity.x[eid], Velocity.y[eid])
      if (speed > 0) {
        const slowed = Math.max(0, speed - (BALL_ROLL_DECEL + BALL_ROLL_DRAG * speed) * dt)
        Velocity.x[eid] *= slowed / speed
        Velocity.y[eid] *= slowed / speed
      }
    }

    if (world.outcome === 'goal') containInNet(eid)
  }
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

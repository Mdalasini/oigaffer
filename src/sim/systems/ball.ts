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
  GRAVITY,
} from '../constants'
import type { Match } from '../match'
import { hypot } from '../fmath'

export function ballSystem(world: Match, dt: number) {
  for (const eid of query(world, [Ball, Position, Velocity])) {
    world.prevBall.x = Position.x[eid]
    world.prevBall.y = Position.y[eid]
    world.prevBall.z = Position.z[eid]
    // In a keeper's hands the ball goes where they carry it.
    if (world.phase === 'held') continue
    Velocity.z[eid] -= GRAVITY * dt
    Position.x[eid] += Velocity.x[eid] * dt
    Position.y[eid] += Velocity.y[eid] * dt
    Position.z[eid] += Velocity.z[eid] * dt

    if (Position.z[eid] <= BALL_RADIUS) {
      Position.z[eid] = BALL_RADIUS
      Velocity.z[eid] = Velocity.z[eid] < -1 ? -Velocity.z[eid] * BALL_RESTITUTION : 0
      const speed = hypot(Velocity.x[eid], Velocity.y[eid])
      if (speed > 0) {
        const slowed = Math.max(0, speed - (BALL_ROLL_DECEL + BALL_ROLL_DRAG * speed) * dt)
        Velocity.x[eid] *= slowed / speed
        Velocity.y[eid] *= slowed / speed
      }
    }

    if (world.phase === 'stopped' && world.event?.kind === 'goal') containInNet(world, eid)
  }
}

/** After a goal, the net holds the ball. */
function containInNet(world: Match, eid: number) {
  const end = Math.sign(Position.x[eid])
  const back = world.pitch.halfLength + GOAL_DEPTH - BALL_RADIUS
  if (Position.x[eid] * end > back) {
    Position.x[eid] = end * back
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

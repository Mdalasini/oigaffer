import { query } from 'bitecs'
import { Goalkeeper, Outfielder, Position, Velocity } from '../components'
import { BALL_RADIUS, GOAL_X } from '../constants'
import { reactionDelay, shotSpreadRadius } from '../grades'
import { setPhase, setVec, type Match } from '../match'
import { chooseAim, launchVelocity, sampleShotTarget } from '../shooting'

const RUN_SPEED = 6.5
const DRIBBLE_OFFSET = 0.6
const SHOT_SPEED = 25

export function strikerSystem(world: Match, dt: number) {
  for (const eid of query(world, [Outfielder, Position, Velocity])) {
    if (world.phase === 'approach') {
      dribbleTowardGoal(world, eid, dt)
      const ball = world.ball
      const distance = Math.hypot(GOAL_X - Position.x[ball], Position.y[ball])
      if (world.shootRequested || distance <= world.shootDistance) shoot(world, eid)
    } else {
      // Follow-through: ease to a stop after the strike.
      const decay = Math.exp(-4 * dt)
      Velocity.x[eid] *= decay
      Velocity.y[eid] *= decay
      Position.x[eid] += Velocity.x[eid] * dt
      Position.y[eid] += Velocity.y[eid] * dt
    }
  }
}

function dribbleTowardGoal(world: Match, eid: number, dt: number) {
  const dx = GOAL_X - Position.x[eid]
  const dy = -Position.y[eid]
  const len = Math.hypot(dx, dy)
  const ux = dx / len
  const uy = dy / len
  setVec(Velocity, eid, ux * RUN_SPEED, uy * RUN_SPEED, 0)
  Position.x[eid] += Velocity.x[eid] * dt
  Position.y[eid] += Velocity.y[eid] * dt

  const ball = world.ball
  setVec(Position, ball, Position.x[eid] + ux * DRIBBLE_OFFSET, Position.y[eid] + uy * DRIBBLE_OFFSET, BALL_RADIUS)
  setVec(Velocity, ball, Velocity.x[eid], Velocity.y[eid], 0)
}

function shoot(world: Match, striker: number) {
  const { ball, keeper } = world
  const from = { x: Position.x[ball], y: Position.y[ball], z: Position.z[ball] }
  const aim = chooseAim(from.y, Position.y[keeper], world.aimHigh)
  const radius = shotSpreadRadius(Outfielder.shooting[striker])
  const target = sampleShotTarget(world.rng, aim, radius)
  const v = launchVelocity(from, target, SHOT_SPEED)
  setVec(Velocity, ball, v.x, v.y, v.z)

  Goalkeeper.reactTimer[keeper] = reactionDelay(Goalkeeper.reaction[keeper])
  world.shot = { origin: from, aim, radius, target, crossing: null }
  world.shootRequested = false
  world.stats.shots++
  setPhase(world, 'shot')
}

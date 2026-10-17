import { query } from 'bitecs'
import { Goalkeeper, MoveIntent, Outfielder, Position, Velocity } from '../components'
import { GOAL_X } from '../constants'
import { reactionDelay, shotSpreadRadius } from '../grades'
import { setPhase, setVec, type Match } from '../match'
import { chooseAim, launchVelocity, sampleShotTarget } from '../shooting'

/** Speed the striker carries the ball at. */
const CARRY_SPEED = 6.5
const SHOT_SPEED = 25

/** The striker's decisions: run the ball at goal, then shoot. */
export function strikerSystem(world: Match, _dt: number) {
  for (const eid of query(world, [Outfielder, MoveIntent])) {
    MoveIntent.faceX[eid] = 0
    MoveIntent.faceY[eid] = 0
    if (world.phase !== 'approach') {
      MoveIntent.vx[eid] = 0
      MoveIntent.vy[eid] = 0
      continue
    }
    const dx = GOAL_X - Position.x[eid]
    const dy = -Position.y[eid]
    const len = Math.hypot(dx, dy)
    MoveIntent.vx[eid] = (dx / len) * CARRY_SPEED
    MoveIntent.vy[eid] = (dy / len) * CARRY_SPEED

    const ball = world.ball
    const distance = Math.hypot(GOAL_X - Position.x[ball], Position.y[ball])
    if (world.shootRequested || distance <= world.shootDistance) shoot(world, eid)
  }
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

import { query } from 'bitecs'
import { angleDelta } from '../angles'
import { Dribbler, Facing, Goalkeeper, MoveIntent, Outfielder, Position, TouchStyle, Velocity } from '../components'
import { GOAL_X } from '../constants'
import { reactionDelay, shotSpreadRadius } from '../grades'
import { setPhase, setVec, type Match } from '../match'
import { chooseAim, launchVelocity, sampleShotTarget } from '../shooting'
import { ballAtFeet, dribble } from '../touch'

const SHOT_SPEED = 25
/**
 * Rough distance (m) covered before a large touch is caught up with, at a
 * given running speed: the faster you run, the further the ball goes.
 */
const largeTouchTravel = (speed: number) => 3 + speed * 2.2
/** Only shoot when facing within this angle (rad) of goal. */
const MAX_SHOT_TURN = 1.3

/** The striker's decisions: dribble at goal with touches, then shoot. */
export function strikerSystem(world: Match, _dt: number) {
  for (const eid of query(world, [Outfielder, MoveIntent, Dribbler])) {
    MoveIntent.faceX[eid] = 0
    MoveIntent.faceY[eid] = 0
    if (world.phase !== 'approach') {
      MoveIntent.vx[eid] = 0
      MoveIntent.vy[eid] = 0
      Dribbler.style[eid] = TouchStyle.None
      continue
    }

    const ball = world.ball
    const toGoalX = GOAL_X - Position.x[ball]
    const toGoalY = -Position.y[ball]
    const distance = Math.hypot(toGoalX, toGoalY)
    const dirX = toGoalX / distance
    const dirY = toGoalY / distance

    if (wantsToShoot(world, eid, distance) && ballAtFeet(eid, ball) && Dribbler.cooldown[eid] === 0) {
      shoot(world, eid)
      continue
    }

    // Knock it long while the next contact would still come before shooting range.
    const speed = Math.hypot(Velocity.x[eid], Velocity.y[eid])
    const style = distance - largeTouchTravel(speed) > world.shootDistance ? TouchStyle.Large : TouchStyle.Small
    dribble(eid, ball, style, dirX, dirY)
  }
}

function wantsToShoot(world: Match, eid: number, distance: number) {
  if (!world.shootRequested && distance > world.shootDistance) return false
  const facingGoal = Math.atan2(-Position.y[eid], GOAL_X - Position.x[eid])
  return Math.abs(angleDelta(Facing.angle[eid], facingGoal)) <= MAX_SHOT_TURN
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
  Dribbler.style[striker] = TouchStyle.None
  world.shot = { origin: from, aim, radius, target, crossing: null }
  world.shootRequested = false
  world.lastTouch = null
  world.stats.shots++
  setPhase(world, 'shot')
}

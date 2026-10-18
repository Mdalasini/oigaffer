import { Body, Position, Velocity } from '../components'
import { ballAtFeet } from '../touch'
import { BALL_RADIUS, GOAL_HALF_WIDTH, GOAL_HEIGHT, GOAL_X, PITCH_HALF_WIDTH } from '../constants'
import { endAttack, resetPlay, type Match, type Restart } from '../match'
import type { GoalPoint } from '../shooting'

/** Reach beyond the keeper's body when stretching out. */
const ARM_REACH = 0.7
const KEEPER_MAX_HEIGHT = 2.5
const RESULT_PAUSE = 2.2
const SHOT_TIMEOUT = 4
/** An attack that never gets a shot away is abandoned and restarted. */
const PLAY_TIMEOUT = 25

export function outcomeSystem(world: Match, _dt: number) {
  if (world.phase === 'result') {
    if (world.autoReset && world.phaseTime >= RESULT_PAUSE) resetPlay(world)
    return
  }
  if (world.phase === 'approach') {
    if (keeperCanClaim(world)) {
      Velocity.x[world.ball] = Velocity.y[world.ball] = Velocity.z[world.ball] = 0
      endAttack(world, 'claimed', null)
    } else if (!leftThePitch(world) && world.phaseTime > PLAY_TIMEOUT) endAttack(world, 'abandoned', null)
    return
  }

  const { ball, keeper, prevBall } = world
  const keeperX = Position.x[keeper]
  const crossing = crossPlane(world, keeperX)
  if (crossing) {
    const reach = Body.radius[keeper] + ARM_REACH
    if (Math.abs(crossing.y - Position.y[keeper]) <= reach && crossing.z <= KEEPER_MAX_HEIGHT) {
      parry(ball, crossing.y - Position.y[keeper])
      endAttack(world, 'save', crossing)
      return
    }
  }

  const atLine = prevBall.x < GOAL_X ? crossPlane(world, GOAL_X) : null
  if (atLine) {
    const inside = Math.abs(atLine.y) <= GOAL_HALF_WIDTH - BALL_RADIUS
    const under = atLine.z <= GOAL_HEIGHT - BALL_RADIUS
    endAttack(world, inside && under ? 'goal' : inside ? 'over' : 'wide', atLine)
    return
  }

  if (world.phaseTime > SHOT_TIMEOUT) endAttack(world, 'wide', null)
}

/**
 * Ends open play once the whole ball is over a line. Over the goal line
 * between the posts it's a goal however it got there; elsewhere the restart
 * goes against whoever touched it last. Shots have their own goal-line check.
 */
function leftThePitch(world: Match): boolean {
  const { ball, prevBall } = world
  const lineX = GOAL_X + BALL_RADIUS
  const atLine = prevBall.x < lineX ? crossPlane(world, lineX) : null
  if (atLine) {
    if (Math.abs(atLine.y) <= GOAL_HALF_WIDTH - BALL_RADIUS && atLine.z <= GOAL_HEIGHT - BALL_RADIUS) {
      // It went in without a shot being struck; count it as one so goals stay a share of shots.
      world.stats.shots++
      endAttack(world, 'goal', atLine)
    } else restartPlay(world, world.lastTouchedBy === world.defender ? 'corner' : 'goal-kick')
    return true
  }
  if (Math.abs(Position.y[ball]) > PITCH_HALF_WIDTH + BALL_RADIUS) {
    restartPlay(world, 'throw-in')
    return true
  }
  return false
}

function restartPlay(world: Match, restart: Restart) {
  Velocity.x[world.ball] = Velocity.y[world.ball] = 0
  world.restart = restart
  endAttack(world, world.lastTouchedBy === world.defender ? 'setPiece' : 'outOfPlay', null)
}

/** A loose ball that runs within the keeper's reach is gathered. */
function keeperCanClaim(world: Match) {
  const { ball, keeper, striker } = world
  if (ballAtFeet(striker, ball) || Position.z[ball] > KEEPER_MAX_HEIGHT) return false
  const reach = Body.radius[keeper] + ARM_REACH
  return Math.hypot(Position.x[ball] - Position.x[keeper], Position.y[ball] - Position.y[keeper]) <= reach
}

/** Where the ball passed through the plane x = planeX during the last step. */
function crossPlane(world: Match, planeX: number): GoalPoint | null {
  const { ball, prevBall } = world
  const x = Position.x[ball]
  if (!(prevBall.x < planeX && x >= planeX)) return null
  const f = (planeX - prevBall.x) / (x - prevBall.x)
  return {
    y: prevBall.y + (Position.y[ball] - prevBall.y) * f,
    z: prevBall.z + (Position.z[ball] - prevBall.z) * f,
  }
}

function parry(ball: number, offset: number) {
  Velocity.x[ball] = -Math.abs(Velocity.x[ball]) * 0.25
  Velocity.y[ball] = Math.sign(offset || 1) * 4
  Velocity.z[ball] = 2
}

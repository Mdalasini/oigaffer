import { query } from 'bitecs'
import { Body, Goalkeeper, Position, Team, Velocity } from '../components'
import { BALL_RADIUS, GOAL_HALF_WIDTH, GOAL_HEIGHT, GOAL_X, PITCH_HALF_WIDTH } from '../constants'
import { ballOut, endShot, keeperClaims, scoreFromPlay, takeRestart, type Match } from '../match'
import type { GoalPoint } from '../shooting'
import { attackDir, opponent } from '../teams'
import { ballAtFeet } from '../touch'

/** Reach beyond the keeper's body when stretching out. */
const ARM_REACH = 0.7
const KEEPER_MAX_HEIGHT = 2.5
/** Seconds the ball stays dead before the restart is taken. */
const STOP_PAUSE = 2.2
/** A shot that hasn't been settled by now has run its course; count it as off target. */
const SHOT_TIMEOUT = 4

export function outcomeSystem(world: Match, _dt: number) {
  if (world.phase === 'stopped') {
    if (world.phaseTime >= STOP_PAUSE) takeRestart(world)
    return
  }
  if (world.phase === 'play') {
    const keeper = claimingKeeper(world)
    if (keeper !== null) {
      Velocity.x[world.ball] = Velocity.y[world.ball] = Velocity.z[world.ball] = 0
      keeperClaims(world, keeper)
    } else leftThePitch(world)
    return
  }

  const shot = world.shot
  if (!shot) return
  const { ball, keeper } = world
  const dir = Math.sign(shot.goalX)
  const crossing = crossPlane(world, Position.x[keeper], dir)
  if (crossing) {
    const reach = Body.radius[keeper] + ARM_REACH
    if (Math.abs(crossing.y - Position.y[keeper]) <= reach && crossing.z <= KEEPER_MAX_HEIGHT) {
      parry(ball, dir, crossing.y - Position.y[keeper])
      endShot(world, 'save', crossing)
      return
    }
  }

  const atLine = crossPlane(world, shot.goalX, dir)
  if (atLine) {
    const inside = Math.abs(atLine.y) <= GOAL_HALF_WIDTH - BALL_RADIUS
    const under = atLine.z <= GOAL_HEIGHT - BALL_RADIUS
    endShot(world, inside && under ? 'goal' : inside ? 'over' : 'wide', atLine)
    return
  }

  if (world.phaseTime > SHOT_TIMEOUT) endShot(world, 'wide', null)
}

/**
 * Stops open play once the whole ball is over a line. Over a goal line
 * between the posts it's a goal however it got there, own goals included;
 * elsewhere the restart goes against whoever touched it last. Shots have
 * their own goal-line check.
 */
function leftThePitch(world: Match) {
  const { ball } = world
  const lastTeam = Team.id[world.lastTouchedBy]
  for (const end of [-1, 1]) {
    const atLine = crossPlane(world, end * (GOAL_X + BALL_RADIUS), end)
    if (!atLine) continue
    // The team attacking this end, and the one defending it.
    const attackers = attackDir(0) === end ? 0 : 1
    const defenders = opponent(attackers)
    if (Math.abs(atLine.y) <= GOAL_HALF_WIDTH - BALL_RADIUS && atLine.z <= GOAL_HEIGHT - BALL_RADIUS) scoreFromPlay(world, attackers)
    else if (lastTeam === defenders) ballOut(world, 'corner', attackers, end * GOAL_X, atLine.y)
    else ballOut(world, 'goal-kick', defenders, end * GOAL_X, atLine.y)
    return
  }
  if (Math.abs(Position.y[ball]) > PITCH_HALF_WIDTH + BALL_RADIUS) {
    ballOut(world, 'throw-in', opponent(lastTeam), Position.x[ball], Position.y[ball])
  }
}

/** A keeper who can gather the loose ball: within reach, and not at an outfielder's feet. */
function claimingKeeper(world: Match): number | null {
  const { ball, striker, defender } = world
  if (ballAtFeet(striker, ball) || ballAtFeet(defender, ball) || Position.z[ball] > KEEPER_MAX_HEIGHT) return null
  for (const keeper of query(world, [Goalkeeper, Position, Body])) {
    const reach = Body.radius[keeper] + ARM_REACH
    if (Math.hypot(Position.x[ball] - Position.x[keeper], Position.y[ball] - Position.y[keeper]) <= reach) return keeper
  }
  return null
}

/** Where the ball passed through the plane x = planeX, moving in direction `dir` (±1 along x), during the last step. */
function crossPlane(world: Match, planeX: number, dir: number): GoalPoint | null {
  const { ball, prevBall } = world
  const x = Position.x[ball]
  if (!((prevBall.x - planeX) * dir < 0 && (x - planeX) * dir >= 0)) return null
  const f = (planeX - prevBall.x) / (x - prevBall.x)
  return {
    y: prevBall.y + (Position.y[ball] - prevBall.y) * f,
    z: prevBall.z + (Position.z[ball] - prevBall.z) * f,
  }
}

function parry(ball: number, dir: number, offset: number) {
  Velocity.x[ball] = -dir * Math.abs(Velocity.x[ball]) * 0.25
  Velocity.y[ball] = Math.sign(offset || 1) * 4
  Velocity.z[ball] = 2
}

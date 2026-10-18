import { query } from 'bitecs'
import { Body, Goalkeeper, Position, Team, Velocity } from '../components'
import { BALL_RADIUS, GOAL_HALF_WIDTH, GOAL_HEIGHT, GOAL_X, PITCH_HALF_WIDTH } from '../constants'
import { catchChance } from '../grades'
import { ballOut, endShot, keeperClaims, scoreFromPlay, takeRestart, type Match } from '../match'
import { passToOutfielder } from './keeper'
import { gaussian } from '../rng'
import type { GoalPoint } from '../shooting'
import { attackDir, opponent } from '../teams'
import { ballAtFeet } from '../touch'

/** Reach beyond the keeper's body when stretching out. */
const ARM_REACH = 0.7
const KEEPER_MAX_HEIGHT = 2.5
/** Above this height (m) a shot can only be punched away, not held. */
const PUNCH_HEIGHT = 2.1
/** At full stretch the chance of holding a shot falls to this share of the keeper's best. */
const STRETCHED_CATCH = 0.6
/** Seconds after a parry before the keeper can go down on the loose ball. */
const PARRY_RECOVER = 0.6
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
    const keeper = keeperWithinReach(world)
    if (keeper === null) leftThePitch(world)
    // Their own outfielder played it to them, so it's feet only: knock it straight back out to them.
    else if (isBackPass(world, keeper)) passToOutfielder(world, keeper, Position.x[world.ball], Position.y[world.ball])
    else keeperClaims(world, keeper)
    return
  }

  const shot = world.shot
  if (!shot) return
  const { keeper } = world
  const dir = Math.sign(shot.goalX)
  const crossing = crossPlane(world, Position.x[keeper], dir)
  if (crossing) {
    const reach = Body.radius[keeper] + ARM_REACH
    const offset = crossing.y - Position.y[keeper]
    if (Math.abs(offset) <= reach && crossing.z <= KEEPER_MAX_HEIGHT) {
      // Shots at the body stick; ones at full stretch or over the head get pushed away.
      const stretch = Math.abs(offset) / reach
      const chance = crossing.z > PUNCH_HEIGHT ? 0 : catchChance(Goalkeeper.handling[keeper]) * (1 - (1 - STRETCHED_CATCH) * stretch)
      if (world.rng() < chance) endShot(world, 'caught', crossing)
      else {
        parry(world, keeper, dir, offset, crossing.z)
        endShot(world, 'parried', crossing)
      }
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

/**
 * A keeper who can get to the loose ball: within reach, not at an
 * outfielder's feet, and not just after parrying it or playing it out.
 */
function keeperWithinReach(world: Match): number | null {
  const { ball, carrier, presser: defender } = world
  if (ballAtFeet(carrier, ball) || ballAtFeet(defender, ball) || Position.z[ball] > KEEPER_MAX_HEIGHT) return null
  for (const keeper of query(world, [Goalkeeper, Position, Body])) {
    if (Goalkeeper.recover[keeper] > 0) continue
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

/** Whether the ball was last played deliberately by `keeper`'s own outfielder: a back-pass they can't pick up. */
export function isBackPass(world: Match, keeper: number) {
  const by = world.lastTouchedBy
  return world.lastTouchDeliberate && by !== keeper && Team.id[by] === Team.id[keeper]
}

/**
 * Pushes the ball away from goal, out to the side the keeper met it on; a
 * high ball is punched up and over. It stays in play for whoever gets there.
 */
function parry(world: Match, keeper: number, dir: number, offset: number, height: number) {
  const ball = world.ball
  const { rng } = world
  const out = 2 + rng() * 4
  const wide = Math.sign(offset || gaussian(rng)) * (3 + rng() * 4)
  Velocity.x[ball] = -dir * out
  Velocity.y[ball] = wide
  Velocity.z[ball] = height > PUNCH_HEIGHT ? 4 + rng() * 2 : 1 + rng() * 2
  world.lastTouchedBy = keeper
  world.lastTouchDeliberate = false
  Goalkeeper.recover[keeper] = PARRY_RECOVER
}

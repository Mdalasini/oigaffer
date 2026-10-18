import { describe, expect, test } from 'bun:test'
import { hasComponent } from 'bitecs'
import { Attacking, Position, Velocity } from './components'
import { BALL_RADIUS, GOAL_X, PITCH_HALF_WIDTH } from './constants'
import { createMatch, setVec, stepMatch, winBall, type Match } from './match'
import { ballAtFeet, roomAhead } from './touch'

const RED = 0
const BLUE = 1

/**
 * Open play, Red on the ball attacking +x, with the ball rolling from (x, y)
 * at (vx, vy), last touched by Red's or Blue's outfielder.
 */
function rolling(x: number, y: number, vx: number, vy: number, toucher: 'striker' | 'defender'): Match {
  const world = createMatch({ seed: 1 })
  // Keep the players well away so nobody can play the ball.
  setVec(Position, world.striker, -15, 0, 0)
  setVec(Position, world.defender, -15, 4, 0)
  setVec(Position, world.ball, x, y, BALL_RADIUS)
  setVec(Velocity, world.ball, vx, vy, 0)
  world.lastTouchedBy = world[toucher]
  return world
}

function playOut(world: Match) {
  for (let i = 0; i < 120 * 3 && world.phase === 'play'; i++) stepMatch(world)
}

describe('out of play', () => {
  test('over the touchline off Red: throw-in to Blue', () => {
    const world = rolling(0, PITCH_HALF_WIDTH - 1, 0, 6, 'striker')
    playOut(world)
    expect(world.event?.kind).toBe('out')
    expect(world.restart).toMatchObject({ kind: 'throw-in', team: BLUE })
  })

  test('over the touchline off Blue: throw-in to Red', () => {
    const world = rolling(0, -PITCH_HALF_WIDTH + 1, 0, -6, 'defender')
    playOut(world)
    expect(world.restart).toMatchObject({ kind: 'throw-in', team: RED })
  })

  test('over the goal line wide, off the attacker: goal kick to the defending team', () => {
    const world = rolling(GOAL_X - 2, 10, 8, 0, 'striker')
    playOut(world)
    expect(world.restart).toMatchObject({ kind: 'goal-kick', team: BLUE })
  })

  test('over the goal line wide, off the defender: corner to the attacking team', () => {
    const world = rolling(GOAL_X - 2, -10, 8, 0, 'defender')
    playOut(world)
    expect(world.restart).toMatchObject({ kind: 'corner', team: RED })
  })

  test('over the other goal line it is the other way round', () => {
    const corner = rolling(-GOAL_X + 2, 10, -8, 0, 'striker')
    playOut(corner)
    expect(corner.restart).toMatchObject({ kind: 'corner', team: BLUE })
    const goalKick = rolling(-GOAL_X + 2, 10, -8, 0, 'defender')
    playOut(goalKick)
    expect(goalKick.restart).toMatchObject({ kind: 'goal-kick', team: RED })
  })

  test('the ball must be wholly over the line', () => {
    const world = rolling(0, PITCH_HALF_WIDTH, 0, 0, 'striker')
    stepMatch(world)
    expect(world.phase).toBe('play')
  })

  test('a ball rolled into the net in open play is a goal, and the other team kicks off', () => {
    const world = rolling(GOAL_X - 3, 0, 9, 0, 'defender')
    // Move the keeper aside so it can't claim the ball.
    setVec(Position, world.keeper, GOAL_X - 0.5, 3, 0)
    playOut(world)
    expect(world.event).toMatchObject({ kind: 'goal', team: RED })
    expect(world.stats[RED]).toMatchObject({ goals: 1, shots: 1 })
    expect(world.restart).toMatchObject({ kind: 'kick-off', team: BLUE })
  })

  test('an own goal counts for the other team', () => {
    const world = rolling(-GOAL_X + 3, 0, -9, 0, 'striker')
    setVec(Position, world.teams[RED].keeper, -GOAL_X + 0.5, 3, 0)
    playOut(world)
    expect(world.event).toMatchObject({ kind: 'goal', team: BLUE })
    expect(world.stats[BLUE].goals).toBe(1)
  })

  test('after the pause the restart is taken by the team given it, ball at their feet', () => {
    const world = rolling(5, PITCH_HALF_WIDTH - 1, 0, 6, 'striker')
    playOut(world)
    for (let i = 0; i < 120 * 3 && world.phase === 'stopped'; i++) stepMatch(world)
    expect(world.phase).toBe('play')
    expect(world.possession).toBe(BLUE)
    const taker = world.teams[BLUE].outfielder
    expect(world.striker).toBe(taker)
    expect(hasComponent(world, taker, Attacking)).toBe(true)
    expect(ballAtFeet(taker, world.ball)).toBe(true)
    // Taken from where it went out, just inside the line.
    expect(Position.x[world.ball]).toBeCloseTo(5, 3)
    expect(Math.abs(Position.y[world.ball])).toBeLessThan(PITCH_HALF_WIDTH)
  })
})

describe('room ahead', () => {
  test('measures the run to the nearest line, but not into either goal mouth', () => {
    expect(roomAhead(GOAL_X - 10, 10, 1, 0)).toBeCloseTo(10, 6)
    expect(roomAhead(-GOAL_X + 10, 10, -1, 0)).toBeCloseTo(10, 6)
    expect(roomAhead(0, PITCH_HALF_WIDTH - 4, 0, 1)).toBeCloseTo(4, 6)
    expect(roomAhead(GOAL_X - 10, 0, 1, 0)).toBe(Infinity)
    expect(roomAhead(-GOAL_X + 10, 0, -1, 0)).toBe(Infinity)
  })
})

describe('after a turnover', () => {
  test('a ball that runs out straight off the winning tackle goes against the tackler', () => {
    const world = rolling(0, PITCH_HALF_WIDTH - 1, 0, 6, 'striker')
    winBall(world, BLUE, 'tackled')
    playOut(world)
    expect(world.restart).toMatchObject({ kind: 'throw-in', team: RED })
  })
})

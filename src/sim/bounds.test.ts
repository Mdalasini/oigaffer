import { describe, expect, test } from 'bun:test'
import { Position, Velocity } from './components'
import { BALL_RADIUS, GOAL_X, PITCH_HALF_WIDTH } from './constants'
import { createMatch, setVec, stepMatch, type Match } from './match'
import { roomAhead } from './touch'

/** Open play with the ball rolling from (x, y) at (vx, vy), last touched by `toucher`. */
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
  for (let i = 0; i < 120 * 3 && world.phase === 'approach'; i++) stepMatch(world)
}

describe('out of play', () => {
  test('over the touchline off the striker: throw-in to the defence', () => {
    const world = rolling(0, PITCH_HALF_WIDTH - 1, 0, 6, 'striker')
    playOut(world)
    expect(world.outcome).toBe('outOfPlay')
    expect(world.restart).toBe('throw-in')
    expect(world.stats.lost).toBe(1)
  })

  test('over the touchline off the defender: throw-in to the attack', () => {
    const world = rolling(0, -PITCH_HALF_WIDTH + 1, 0, -6, 'defender')
    playOut(world)
    expect(world.outcome).toBe('setPiece')
    expect(world.restart).toBe('throw-in')
    expect(world.stats.setPieces).toBe(1)
  })

  test('over the goal line wide, off the striker: goal kick', () => {
    const world = rolling(GOAL_X - 2, 10, 8, 0, 'striker')
    playOut(world)
    expect(world.outcome).toBe('outOfPlay')
    expect(world.restart).toBe('goal-kick')
  })

  test('over the goal line wide, off the defender: corner', () => {
    const world = rolling(GOAL_X - 2, -10, 8, 0, 'defender')
    playOut(world)
    expect(world.outcome).toBe('setPiece')
    expect(world.restart).toBe('corner')
  })

  test('the ball must be wholly over the line', () => {
    const world = rolling(0, PITCH_HALF_WIDTH, 0, 0, 'striker')
    stepMatch(world)
    expect(world.phase).toBe('approach')
  })

  test('a ball rolled into the net in open play is a goal', () => {
    const world = rolling(GOAL_X - 3, 0, 9, 0, 'defender')
    // Move the keeper aside so it can't claim the ball.
    setVec(Position, world.keeper, GOAL_X - 0.5, 3, 0)
    playOut(world)
    expect(world.outcome).toBe('goal')
    expect(world.stats.shots).toBe(1)
  })
})

describe('room ahead', () => {
  test('measures the run to the nearest line, but not into the goal mouth', () => {
    expect(roomAhead(GOAL_X - 10, 10, 1, 0)).toBeCloseTo(10, 6)
    expect(roomAhead(0, PITCH_HALF_WIDTH - 4, 0, 1)).toBeCloseTo(4, 6)
    expect(roomAhead(GOAL_X - 10, 0, 1, 0)).toBe(Infinity)
  })
})

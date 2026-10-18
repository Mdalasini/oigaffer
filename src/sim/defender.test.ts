import { describe, expect, test } from 'bun:test'
import { angleDelta } from './angles'
import { Defender, DefenderMode, Facing, Position, TakeOn, Velocity } from './components'
import { BALL_RADIUS, FIXED_DT, GOAL_X } from './constants'
import { createMatch, setVec, stepMatch, type GradeOverrides, type Match } from './match'
import { ballBodySystem, collisionSystem } from './systems/collision'
import { contestSystem } from './systems/contest'
import { defenderSystem } from './systems/defender'
import { shotUnderway } from './testUtils'
import { FOOT_OFFSET } from './touch'

/** Striker with the ball 20 m out, defender `gap` metres goal-side of it. */
function faceOff(gap: number, grades: GradeOverrides = {}): Match {
  const world = createMatch({ seed: 1, grades })
  const { striker, defender, ball } = world
  setVec(Position, striker, GOAL_X - 20, 0, 0)
  Facing.angle[striker] = 0
  setVec(Position, ball, GOAL_X - 20 + FOOT_OFFSET, 0, BALL_RADIUS)
  setVec(Position, defender, GOAL_X - 20 + gap, 0, 0)
  Facing.angle[defender] = Math.PI
  Defender.readX[defender] = Position.x[ball]
  Defender.readY[defender] = Position.y[ball]
  return world
}

const angleToBall = (world: Match, eid: number) =>
  Math.atan2(Position.y[world.ball] - Position.y[eid], Position.x[world.ball] - Position.x[eid])

/**
 * Share of Red's spells on the ball, once Red has started to take Blue on, in
 * which Red gets the ball goal-side of Blue.
 */
function beatenRate(grades: GradeOverrides, attacks: number) {
  const world = createMatch({ seed: 7, grades })
  let played = 0
  let beaten = 0
  let spell = -1
  let engaged = false
  let counted = false
  while (played < attacks) {
    stepMatch(world)
    // Each Red spell on the ball is numbered by Red's attack count; Blue's are all -1.
    const current = world.possession === 0 ? world.stats[0].attacks : -1
    if (current !== spell) {
      if (engaged) played++
      spell = current
      engaged = counted = false
    }
    if (current === -1 || world.phase !== 'play') continue
    engaged ||= TakeOn.side[world.striker] !== 0
    if (counted || !engaged) continue
    const { ball, defender } = world
    const gx = GOAL_X - Position.x[ball]
    const gy = -Position.y[ball]
    const along = ((Position.x[defender] - Position.x[ball]) * gx + (Position.y[defender] - Position.y[ball]) * gy) / Math.hypot(gx, gy)
    if (along < -1) {
      beaten++
      counted = true
    }
  }
  return beaten / attacks
}

describe('defender', () => {
  test('jockeys side-on to the ball when close and goal-side', () => {
    const world = faceOff(3)
    // Ball carried across the defender's face.
    setVec(Velocity, world.ball, 0, 3, 0)
    for (let i = 0; i < 30; i++) stepMatch(world)
    const { defender } = world
    expect(Defender.mode[defender]).toBe(DefenderMode.Jockey)
    expect(Math.abs(angleDelta(Facing.angle[defender], angleToBall(world, defender)))).toBeLessThan(0.3)
  })

  test('turns and runs once the ball is past', () => {
    const world = faceOff(-3)
    defenderSystem(world, FIXED_DT)
    expect(Defender.mode[world.defender]).toBe(DefenderMode.Run)
  })

  test('better marking and agility are harder to get past', () => {
    const weak = beatenRate({ blue: { outfielder: { marking: 1, agility: 5 } } }, 120)
    const strong = beatenRate({ blue: { outfielder: { marking: 20, agility: 20 } } }, 120)
    expect(strong).toBeLessThan(weak - 0.25)
  })

  test('players cannot overlap, even three at once', () => {
    const world = faceOff(0.5)
    const { striker, defender, keeper } = world
    setVec(Position, keeper, GOAL_X - 19, 0, 0)
    collisionSystem(world, FIXED_DT)
    const gap = (a: number, b: number) => Math.hypot(Position.x[b] - Position.x[a], Position.y[b] - Position.y[a])
    expect(gap(striker, defender)).toBeGreaterThan(0.7 - 1e-3)
    expect(gap(defender, keeper)).toBeGreaterThan(0.75 - 1e-3)
    expect(gap(striker, keeper)).toBeGreaterThan(0.75 - 1e-3)
  })

  test('a fast shot clipping the edge of the defender is still blocked', () => {
    const world = faceOff(4)
    const { ball, defender } = world
    shotUnderway(world)
    // Starts just outside the legs and ends this step inside them, already heading out.
    const dx = Position.x[defender]
    const dy = Position.y[defender]
    world.prevBall = { x: dx - 0.18, y: dy + 0.35, z: 0.5 }
    setVec(Position, ball, dx + 0.028, dy + 0.35, 0.5)
    setVec(Velocity, ball, 25, 0, 0)
    ballBodySystem(world, FIXED_DT)
    expect(world.event?.kind).toBe('blocked')
  })

  test('wins a ball that has got away from the carrier', () => {
    const world = faceOff(5)
    const { ball, defender } = world
    setVec(Position, ball, Position.x[defender] - FOOT_OFFSET - 0.3, 0, BALL_RADIUS)
    contestSystem(world, FIXED_DT)
    expect(world.event?.kind).toBe('intercepted')
  })

  test('has to tackle for a ball still under the carrier’s control', () => {
    const world = faceOff(1.6)
    // Ball within reach of both players' feet.
    setVec(Position, world.ball, GOAL_X - 20 + 0.8, 0, BALL_RADIUS)
    contestSystem(world, FIXED_DT)
    expect(world.event).toBeNull()
  })

  test('a shot into the defender is blocked', () => {
    const world = faceOff(4)
    shotUnderway(world)
    setVec(Position, world.ball, GOAL_X - 16.5, 0, 0.5)
    setVec(Velocity, world.ball, 25, 0, 0)
    for (let i = 0; i < 10 && world.phase === 'shot'; i++) stepMatch(world)
    expect(world.event?.kind).toBe('blocked')
  })
})

import { describe, expect, test } from 'bun:test'
import { hasComponent } from 'bitecs'
import { bodyBetween, resolveBarge, resolveStandingTackle } from './challenge'
import { Defender, DefenderMode, Dribbler, Facing, OffBalance, Position, Shield, Sliding, TakeOn, TouchStyle, Velocity } from './components'
import { BALL_RADIUS, FIXED_DT, GOAL_X } from './constants'
import { createMatch, setVec, stepMatch, type GradeOverrides, type Match } from './match'
import { simulateMatch } from './simulate'
import { challengeSystem } from './systems/challenge'
import { ballBodySystem } from './systems/collision'
import { contestSystem } from './systems/contest'
import { startSlide } from './systems/defender'
import { touchSystem } from './systems/touch'
import { shotUnderway } from './testUtils'
import { FOOT_OFFSET } from './touch'

/** Carrier facing goal at the origin of play, defender `gap` m in front facing back at it, ball `ballAhead` m in front of the carrier. */
function setup(seed: number, gap: number, ballAhead: number, grades: GradeOverrides = {}): Match {
  const world = createMatch({ seed, grades })
  const { carrier, presser: defender, ball } = world
  const x = GOAL_X - 20
  setVec(Position, carrier, x, 0, 0)
  setVec(Velocity, carrier, 0, 0, 0)
  Facing.angle[carrier] = 0
  setVec(Position, defender, x + gap, 0, 0)
  setVec(Velocity, defender, 0, 0, 0)
  Facing.angle[defender] = Math.PI
  setVec(Position, ball, x + ballAhead, 0, BALL_RADIUS)
  setVec(Velocity, ball, 0, 0, 0)
  return world
}

/** Share of standing tackles that win or poke the ball, over many seeds. */
function standingTackleSuccess(gap: number, ballAhead: number, grades: GradeOverrides = {}, place?: (world: Match) => void) {
  let successes = 0
  const tries = 400
  for (let seed = 1; seed <= tries; seed++) {
    const world = setup(seed, gap, ballAhead, grades)
    place?.(world)
    resolveStandingTackle(world, world.presser)
    const result = world.lastChallenge?.result
    if (result === 'won' || result === 'poked') successes++
  }
  return successes / tries
}

describe('standing tackles', () => {
  test('a ball between touches is easier to take than one at the feet', () => {
    const atFeet = standingTackleSuccess(1.4, FOOT_OFFSET + 0.1)
    const between = standingTackleSuccess(1.9, FOOT_OFFSET + 0.9)
    expect(between).toBeGreaterThan(atFeet * 2)
  })

  test('better tackling beats better dribbling more often', () => {
    const strong = standingTackleSuccess(1.9, FOOT_OFFSET + 0.9, { blue: { outfielder: { tackling: 20 } }, red: { outfielder: { dribbling: 5 } } })
    const weak = standingTackleSuccess(1.9, FOOT_OFFSET + 0.9, { blue: { outfielder: { tackling: 5 } }, red: { outfielder: { dribbling: 20 } } })
    expect(strong).toBeGreaterThan(weak + 0.3)
  })

  test("tackling through the carrier's body rarely works", () => {
    // Ball behind the carrier, carrier between it and the defender.
    const shielded = standingTackleSuccess(0.75, -0.45, {}, (world) => {
      Facing.angle[world.presser] = Math.PI
    })
    const open = standingTackleSuccess(1.9, FOOT_OFFSET + 0.9)
    expect(shielded).toBeLessThan(open / 2)
  })

  test('a ball out of reach is a miss that leaves the tackler off balance', () => {
    const world = setup(1, 4, FOOT_OFFSET)
    resolveStandingTackle(world, world.presser)
    expect(world.lastChallenge?.result).toBe('missed')
    expect(OffBalance.timer[world.presser]).toBeGreaterThan(0)
  })
})

describe('barging', () => {
  const bargeWins = (defenderStrength: number, carrierStrength: number) => {
    let wins = 0
    for (let seed = 1; seed <= 300; seed++) {
      const world = setup(seed, 0.7, FOOT_OFFSET, { blue: { outfielder: { strength: defenderStrength } }, red: { outfielder: { strength: carrierStrength } } })
      resolveBarge(world, world.presser)
      if (world.lastChallenge?.result === 'won') wins++
    }
    return wins / 300
  }

  test('the stronger player usually wins', () => {
    expect(bargeWins(20, 5)).toBeGreaterThan(0.75)
    expect(bargeWins(5, 20)).toBeLessThan(0.25)
  })

  test('the loser is knocked off balance and cannot play the ball', () => {
    const world = setup(3, 0.7, FOOT_OFFSET + 0.1, { blue: { outfielder: { strength: 20 } }, red: { outfielder: { strength: 1 } } })
    resolveBarge(world, world.presser)
    expect(world.lastChallenge?.result).toBe('won')
    const { carrier, ball } = world
    expect(OffBalance.timer[carrier]).toBeGreaterThan(0)
    Dribbler.style[carrier] = TouchStyle.Small
    Dribbler.dirX[carrier] = 1
    Dribbler.dirY[carrier] = 0
    touchSystem(world, FIXED_DT)
    expect(Velocity.x[ball]).toBe(0)
  })
})

describe('sliding tackles', () => {
  test('a slide covers ground on momentum, goes to ground, then gets up', () => {
    const world = setup(1, -2, 6)
    const { presser: defender, ball } = world
    setVec(Velocity, defender, 6, 0, 0)
    Facing.angle[defender] = 0
    Defender.readX[defender] = Position.x[ball]
    Defender.readY[defender] = Position.y[ball]
    startSlide(world, defender)
    expect(hasComponent(world, defender, Sliding)).toBe(true)
    const startX = Position.x[defender]
    let grounded = false
    for (let i = 0; i < 120 * 3; i++) {
      challengeSystem(world, FIXED_DT)
      grounded ||= Defender.mode[defender] === DefenderMode.Grounded
    }
    expect(Position.x[defender] - startX).toBeGreaterThan(2)
    expect(grounded).toBe(true)
    expect(hasComponent(world, defender, Sliding)).toBe(false)
    expect(Defender.mode[defender]).toBe(DefenderMode.Run)
  })
})

describe('challenges across the end of an attack', () => {
  test('a defender sliding when the shot goes in still slides out and gets up', () => {
    const world = setup(1, -2, 6)
    const { presser: defender, ball } = world
    setVec(Velocity, defender, 6, 0, 0)
    Defender.readX[defender] = Position.x[ball]
    Defender.readY[defender] = Position.y[ball]
    startSlide(world, defender)
    shotUnderway(world)
    const startX = Position.x[defender]
    for (let i = 0; i < 120 * 3; i++) challengeSystem(world, FIXED_DT)
    expect(Position.x[defender] - startX).toBeGreaterThan(2)
    expect(hasComponent(world, defender, Sliding)).toBe(false)
  })

  test('an off-balance defender cannot gather a loose ball', () => {
    const world = setup(1, 5, FOOT_OFFSET)
    const { ball, presser: defender } = world
    setVec(Position, ball, Position.x[defender] - FOOT_OFFSET - 0.3, 0, BALL_RADIUS)
    OffBalance.timer[defender] = 0.3
    contestSystem(world, FIXED_DT)
    expect(world.event).toBeNull()
  })

  test('a shot passes over a defender on the ground', () => {
    const world = setup(1, 4, FOOT_OFFSET)
    const { ball, presser: defender } = world
    Defender.readX[defender] = Position.x[ball]
    Defender.readY[defender] = Position.y[ball]
    startSlide(world, defender)
    shotUnderway(world)
    world.prevBall = { x: Position.x[defender] - 0.5, y: Position.y[defender], z: 1 }
    setVec(Position, ball, Position.x[defender] + 0.2, Position.y[defender], 1)
    setVec(Velocity, ball, 25, 0, 0)
    ballBodySystem(world, FIXED_DT)
    expect(world.event).toBeNull()
  })
})

describe('shielding', () => {
  test('with the defender tight and the ball on the far side, the carrier shields it', () => {
    const world = setup(2, 1.1, -0.3)
    const { carrier, presser: defender, ball } = world
    // Ball tucked on the carrier's far side from the defender.
    Facing.angle[carrier] = Math.PI
    for (let i = 0; i < 20; i++) stepMatch(world)
    expect(Shield.active[carrier]).toBe(1)
    expect(bodyBetween(carrier, defender, ball)).toBe(true)
  })

  test('turning away after a shield keeps to the chosen side', () => {
    const world = setup(2, 1.1, -0.3)
    const { carrier, presser: defender } = world
    Facing.angle[carrier] = Math.PI
    // Defender just to the left of the carrier's line, so the turn away is to the right.
    Position.y[defender] = 0.2
    TakeOn.checkBackTimer[carrier] = 0
    for (let i = 0; i < 20; i++) stepMatch(world)
    expect(Shield.active[carrier]).toBe(1)
    Shield.timer[carrier] = 0
    stepMatch(world)
    expect(Shield.active[carrier]).toBe(0)
    expect(TakeOn.side[carrier]).toBe(-1)
    expect(TakeOn.checkBackTimer[carrier]).toBeGreaterThan(0)
  })
})

describe('outcomes', () => {
  test('a better tackler wins the ball more often over many attacks', () => {
    /** Share of Red's spells on the ball that end with Blue winning it back. */
    const lostRate = (tackling: number, dribbling: number) => {
      const [red, blue] = simulateMatch(30, { seed: 5, grades: { blue: { outfielder: { tackling } }, red: { outfielder: { dribbling } } } })
      return blue.won / red.attacks
    }
    expect(lostRate(20, 5)).toBeGreaterThan(lostRate(5, 20) + 0.2)
  })
})

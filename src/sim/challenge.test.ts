import { describe, expect, test } from 'bun:test'
import { hasComponent } from 'bitecs'
import { bodyBetween, resolveBarge, resolveStandingTackle } from './challenge'
import { Defender, DefenderMode, Dribbler, Facing, OffBalance, Position, Shield, Sliding, TakeOn, TouchStyle, Velocity } from './components'
import { BALL_RADIUS, FIXED_DT } from './constants'
import { SMALL_SIDED_PITCH } from './pitch'
import { createMatch, setVec, stepMatch, type GradeOverrides, type Match } from './match'
import { challengeSystem } from './systems/challenge'
import { ballBodySystem } from './systems/collision'
import { contestSystem } from './systems/contest'
import { defenderSystem, startSlide } from './systems/defender'
import { touchSystem } from './systems/touch'
import { shotUnderway } from './testUtils'
import { lookAround } from './perception'
import { FOOT_OFFSET } from './touch'

// These scenes play on the default five-a-side pitch.
const GOAL_X = SMALL_SIDED_PITCH.halfLength

const RED = 0
const BLUE = 1

/** Carrier facing goal at the origin of play, defender `gap` m in front facing back at it, ball `ballAhead` m in front of the carrier. */
function setup(seed: number, gap: number, ballAhead: number, grades: GradeOverrides = {}): Match {
  const world = createMatch({ outfielders: 2, seed, grades })
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
  /**
   * Share of 100 seeds in which a beaten defender, coming from behind and to
   * the side of the carrier at `speed`, goes to ground within a second,
   * with the ball `ballAhead` m in front of the carrier.
   */
  function slides(speed: number, ballAhead: number, readAhead = ballAhead) {
    let n = 0
    for (let seed = 1; seed <= 100; seed++) {
      const world = setup(seed, 0, ballAhead)
      const { presser: defender, ball, carrier } = world
      setVec(Position, defender, Position.x[carrier] - 0.8, 1.2, 0)
      const angle = Math.atan2(Position.y[ball] - 1.2, Position.x[ball] - Position.x[defender])
      setVec(Velocity, defender, Math.cos(angle) * speed, Math.sin(angle) * speed, 0)
      Facing.angle[defender] = angle
      Defender.mode[defender] = DefenderMode.Run
      lookAround(world)
      Defender.challengeDelay[defender] = 0
      for (let i = 0; i < 120 && !hasComponent(world, defender, Sliding); i++) {
        // Where the defender reads the ball to be, which may not be where it is.
        Defender.readX[defender] = Position.x[carrier] + readAhead
        Defender.readY[defender] = Position.y[ball]
        Defender.readVx[defender] = Defender.readVy[defender] = 0
        defenderSystem(world, FIXED_DT)
      }
      if (hasComponent(world, defender, Sliding)) n++
    }
    return n / 100
  }

  test('a beaten defender stays on their feet while the carrier has the ball at their feet', () => {
    expect(slides(7, FOOT_OFFSET + 0.1)).toBe(0)
  })

  test('a beaten defender at full tilt can go to ground for a ball knocked out of the carrier’s reach, but only sometimes', () => {
    const share = slides(7, 1.3)
    expect(share).toBeGreaterThan(0)
    expect(share).toBeLessThan(0.6)
  })

  test('whether to go to ground is judged on the defender’s read of the ball, not where it really is', () => {
    expect(slides(7, 1.3, FOOT_OFFSET + 0.1)).toBe(0)
    expect(slides(7, FOOT_OFFSET + 0.1, 1.3)).toBeGreaterThan(0)
  })

  test('nobody slides in from a standstill', () => {
    expect(slides(1, 1.3)).toBe(0)
  })

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
    /** Tackles Blue wins per Red spell on the ball, over half an hour. */
    const tackledRate = (tackling: number, dribbling: number) => {
      let tackled = 0
      let attacks = 0
      // One match alone varies a lot with how its attacks go, so three are pooled.
      for (const seed of [4, 5, 6]) {
        const world = createMatch({ outfielders: 2, seed, grades: { blue: { outfielder: { tackling } }, red: { outfielder: { dribbling } } } })
        world.onEvent = (e) => {
          if (e.team === BLUE && e.kind === 'tackled') tackled++
        }
        while (world.time < 30 * 60) stepMatch(world)
        attacks += world.stats[RED].attacks
      }
      return tackled / attacks
    }
    // Measured at 0.12–0.22 against 0.01–0.07 for single seeds. Counting interceptions too, as this once did, mostly
    // measures how attacks end, which shifted once players stopped shooting at the first chance.
    expect(tackledRate(20, 5)).toBeGreaterThan(tackledRate(5, 20) + 0.08)
  }, 40_000)
})

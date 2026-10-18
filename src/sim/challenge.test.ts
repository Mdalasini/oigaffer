import { describe, expect, test } from 'bun:test'
import { hasComponent } from 'bitecs'
import { bodyBetween, resolveBarge, resolveStandingTackle } from './challenge'
import { Defender, DefenderMode, Dribbler, Facing, OffBalance, Position, Shield, Sliding, TouchStyle, Velocity } from './components'
import { BALL_RADIUS, FIXED_DT, GOAL_X } from './constants'
import { createMatch, setVec, stepMatch, type GradeOverrides, type Match } from './match'
import { simulateAttacks } from './simulate'
import { challengeSystem } from './systems/challenge'
import { startSlide } from './systems/defender'
import { touchSystem } from './systems/touch'
import { FOOT_OFFSET } from './touch'

/** Striker facing goal at the origin of play, defender `gap` m in front facing back at it, ball `ballAhead` m in front of the striker. */
function setup(seed: number, gap: number, ballAhead: number, grades: GradeOverrides = {}): Match {
  const world = createMatch({ seed, grades })
  const { striker, defender, ball } = world
  const x = GOAL_X - 20
  setVec(Position, striker, x, 0, 0)
  setVec(Velocity, striker, 0, 0, 0)
  Facing.angle[striker] = 0
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
    resolveStandingTackle(world, world.defender)
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
    const strong = standingTackleSuccess(1.9, FOOT_OFFSET + 0.9, { defender: { tackling: 20 }, striker: { dribbling: 5 } })
    const weak = standingTackleSuccess(1.9, FOOT_OFFSET + 0.9, { defender: { tackling: 5 }, striker: { dribbling: 20 } })
    expect(strong).toBeGreaterThan(weak + 0.3)
  })

  test("tackling through the carrier's body rarely works", () => {
    // Ball behind the striker, striker between it and the defender.
    const shielded = standingTackleSuccess(0.75, -0.45, {}, (world) => {
      Facing.angle[world.defender] = Math.PI
    })
    const open = standingTackleSuccess(1.9, FOOT_OFFSET + 0.9)
    expect(shielded).toBeLessThan(open / 2)
  })

  test('a ball out of reach is a miss that leaves the tackler off balance', () => {
    const world = setup(1, 4, FOOT_OFFSET)
    resolveStandingTackle(world, world.defender)
    expect(world.lastChallenge?.result).toBe('missed')
    expect(OffBalance.timer[world.defender]).toBeGreaterThan(0)
  })
})

describe('barging', () => {
  const bargeWins = (defenderStrength: number, strikerStrength: number) => {
    let wins = 0
    for (let seed = 1; seed <= 300; seed++) {
      const world = setup(seed, 0.7, FOOT_OFFSET, { defender: { strength: defenderStrength }, striker: { strength: strikerStrength } })
      resolveBarge(world, world.defender)
      if (world.lastChallenge?.result === 'won') wins++
    }
    return wins / 300
  }

  test('the stronger player usually wins', () => {
    expect(bargeWins(20, 5)).toBeGreaterThan(0.75)
    expect(bargeWins(5, 20)).toBeLessThan(0.25)
  })

  test('the loser is knocked off balance and cannot play the ball', () => {
    const world = setup(3, 0.7, FOOT_OFFSET + 0.1, { defender: { strength: 20 }, striker: { strength: 1 } })
    resolveBarge(world, world.defender)
    expect(world.lastChallenge?.result).toBe('won')
    const { striker, ball } = world
    expect(OffBalance.timer[striker]).toBeGreaterThan(0)
    Dribbler.style[striker] = TouchStyle.Small
    Dribbler.dirX[striker] = 1
    Dribbler.dirY[striker] = 0
    touchSystem(world, FIXED_DT)
    expect(Velocity.x[ball]).toBe(0)
  })
})

describe('sliding tackles', () => {
  test('a slide covers ground on momentum, goes to ground, then gets up', () => {
    const world = setup(1, -2, 6)
    const { defender, ball } = world
    setVec(Velocity, defender, 6, 0, 0)
    Facing.angle[defender] = 0
    startSlide(world, defender, ball)
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

describe('shielding', () => {
  test('with the defender tight and the ball on the far side, the striker shields it', () => {
    const world = setup(2, 1.1, -0.3)
    const { striker, defender, ball } = world
    // Ball tucked on the striker's far side from the defender.
    Facing.angle[striker] = Math.PI
    for (let i = 0; i < 20; i++) stepMatch(world)
    expect(Shield.active[striker]).toBe(1)
    expect(bodyBetween(striker, defender, ball)).toBe(true)
  })
})

describe('outcomes', () => {
  test('a better tackler wins the ball more often over many attacks', () => {
    const lostRate = (tackling: number, dribbling: number) => {
      const s = simulateAttacks(150, { seed: 5, grades: { defender: { tackling }, striker: { dribbling } } })
      return s.lost / (s.shots + s.lost)
    }
    expect(lostRate(20, 5)).toBeGreaterThan(lostRate(5, 20) + 0.2)
  })
})

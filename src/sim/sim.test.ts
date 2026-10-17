import { describe, expect, test } from 'bun:test'
import { BALL_RADIUS, GOAL_X, GRAVITY } from './constants'
import { reactionDelay, shotSpreadRadius } from './grades'
import { createRng } from './rng'
import { launchVelocity, sampleShotTarget } from './shooting'
import { createMatch, stepMatch } from './match'
import { simulateAttacks } from './simulate'

describe('grades', () => {
  test('better shooters have a tighter spread circle', () => {
    for (let g = 1; g < 20; g++) expect(shotSpreadRadius(g + 1)).toBeLessThan(shotSpreadRadius(g))
  })

  test('better keepers react sooner', () => {
    for (let g = 1; g < 20; g++) expect(reactionDelay(g + 1)).toBeLessThan(reactionDelay(g))
  })
})

describe('shooting', () => {
  test('shots land inside the spread circle', () => {
    const rng = createRng(3)
    const aim = { y: 2, z: 1.5 }
    for (let i = 0; i < 1000; i++) {
      const t = sampleShotTarget(rng, aim, 1.2)
      expect(Math.hypot(t.y - aim.y, t.z - aim.z)).toBeLessThanOrEqual(1.2 + 1e-9)
    }
  })

  test('launch velocity carries the ball through the target', () => {
    const from = { x: GOAL_X - 16, y: -4, z: BALL_RADIUS }
    const target = { y: 2.5, z: 1.8 }
    const v = launchVelocity(from, target, 25)
    const t = (GOAL_X - from.x) / v.x
    expect(from.y + v.y * t).toBeCloseTo(target.y, 6)
    expect(from.z + v.z * t - 0.5 * GRAVITY * t * t).toBeCloseTo(target.z, 6)
  })
})

describe('match outcomes', () => {
  const ATTACKS = 300
  /** Goal rate for a striker against a keeper alone, so only these two grades matter. */
  const rate = (shooting: number, reaction: number) => {
    const s = simulateAttacks(ATTACKS, { seed: 11, defender: false, grades: { striker: { shooting }, keeper: { reaction } } })
    return s.goals / s.shots
  }

  test('a better shooter scores more against the same keeper', () => {
    expect(rate(18, 12)).toBeGreaterThan(rate(4, 12) + 0.15)
  })

  test('a quicker keeper concedes less to the same shooter', () => {
    expect(rate(14, 18)).toBeLessThan(rate(14, 4) - 0.15)
  })

  test('every attack is accounted for', () => {
    const s = simulateAttacks(ATTACKS, { seed: 5 })
    expect(s.shots + s.lost).toBe(ATTACKS)
    expect(s.goals + s.saves + s.misses).toBe(s.shots)
  })

  test('a stalled attack ends through the result phase and respects auto-replay', () => {
    const match = createMatch({ seed: 2 })
    match.autoReset = false
    // Pretend open play has already run for the full timeout.
    match.phaseTime = 25
    stepMatch(match)
    expect(match.phase).toBe('result')
    expect(match.outcome).toBe('abandoned')
    for (let i = 0; i < 120 * 5; i++) stepMatch(match)
    expect(match.phase).toBe('result')
  })

  test('the same seed replays the same match', () => {
    const options = { seed: 42, grades: { striker: { shooting: 12 }, keeper: { reaction: 9 } } }
    expect(simulateAttacks(50, options)).toEqual(simulateAttacks(50, options))
  })
})

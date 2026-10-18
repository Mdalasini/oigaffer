import { describe, expect, test } from 'bun:test'
import { BALL_RADIUS, GOAL_X, GRAVITY } from './constants'
import { reactionDelay, shotAngleError } from './grades'
import { createRng } from './rng'
import { launchVelocity, sampleShotTarget } from './shooting'
import { hasComponent } from 'bitecs'
import { OnBall, Pressing } from './components'
import { createMatch, winBall } from './match'
import { simulateMatch } from './simulate'

describe('grades', () => {
  test('better shooters strike it truer', () => {
    for (let g = 1; g < 20; g++) expect(shotAngleError(g + 1)).toBeLessThan(shotAngleError(g))
  })

  test('better keepers react sooner', () => {
    for (let g = 1; g < 20; g++) expect(reactionDelay(g + 1)).toBeLessThan(reactionDelay(g))
  })
})

describe('shooting', () => {
  test('shots land around the aim, about as far off as the expected miss', () => {
    const rng = createRng(3)
    const aim = { y: 2, z: 1.5 }
    let inside = 0
    let sumY = 0
    for (let i = 0; i < 2000; i++) {
      const t = sampleShotTarget(rng, aim, 0.6)
      sumY += t.y - aim.y
      // The drawn circle is twice the expected miss.
      if (Math.hypot(t.y - aim.y, t.z - aim.z) <= 1.2) inside++
    }
    expect(Math.abs(sumY / 2000)).toBeLessThan(0.05)
    expect(inside / 2000).toBeGreaterThan(0.85)
  })

  test('launch velocity carries the ball through the target', () => {
    const from = { x: GOAL_X - 16, y: -4, z: BALL_RADIUS }
    const target = { y: 2.5, z: 1.8 }
    const v = launchVelocity(from, target, 25, GOAL_X)
    const t = (GOAL_X - from.x) / v.x
    expect(from.y + v.y * t).toBeCloseTo(target.y, 6)
    expect(from.z + v.z * t - 0.5 * GRAVITY * t * t).toBeCloseTo(target.z, 6)
  })
})

describe('match outcomes', () => {
  test('every shot is accounted for, and both sides attack and win the ball back', () => {
    for (const s of simulateMatch(10, { seed: 5 })) {
      expect(s.goals + s.saved + s.missed).toBe(s.shots)
      // Measured at 5–10 a side in ten minutes now that players shoot only when the chance is worth it.
      expect(s.shots).toBeGreaterThan(2)
      expect(s.won).toBeGreaterThan(3)
    }
  })

  test('winning the ball back turns defence into attack', () => {
    const world = createMatch({ outfielders: 2, seed: 3 })
    const red = world.carrier
    const blue = world.presser
    winBall(world, blue, 'tackled')
    expect(world.possession).toBe(1)
    expect(world.carrier).toBe(blue)
    expect(world.presser).toBe(red)
    expect(hasComponent(world, blue, OnBall) && !hasComponent(world, blue, Pressing)).toBe(true)
    expect(hasComponent(world, red, Pressing) && !hasComponent(world, red, OnBall)).toBe(true)
    // Blue now attacks the goal at -x, defended by Red's keeper.
    expect(world.keeper).toBe(world.teams[0].keeper)
    expect(world.stats[1].won).toBe(1)
  })

  test('a shot blocked straight back to the shooter is not struck again and again', () => {
    // Seed 1 once had a crowded edge of the box where every shot was blocked back to the
    // shooter's feet and struck again the next tick, hundreds of times.
    for (const s of simulateMatch(5, { seed: 1 })) expect(s.shots).toBeLessThan(30)
  })

  test('the same seed replays the same match', () => {
    const options = { seed: 42, grades: { red: { outfielder: { shooting: 12 } }, blue: { keeper: { reaction: 9 } } } }
    expect(simulateMatch(5, options)).toEqual(simulateMatch(5, options))
  })
})

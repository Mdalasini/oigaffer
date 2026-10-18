import { describe, expect, test } from 'bun:test'
import { BALL_RADIUS, GOAL_X, GRAVITY } from './constants'
import { reactionDelay, shotSpreadRadius } from './grades'
import { createRng } from './rng'
import { launchVelocity, sampleShotTarget } from './shooting'
import { hasComponent } from 'bitecs'
import { OnBall, Pressing } from './components'
import { createMatch, winBall, type TeamStats } from './match'
import { simulateMatch } from './simulate'

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
    const v = launchVelocity(from, target, 25, GOAL_X)
    const t = (GOAL_X - from.x) / v.x
    expect(from.y + v.y * t).toBeCloseTo(target.y, 6)
    expect(from.z + v.z * t - 0.5 * GRAVITY * t * t).toBeCloseTo(target.z, 6)
  })
})

describe('match outcomes', () => {
  const MINUTES = 30
  const conversion = (s: TeamStats) => s.goals / s.shots

  test('a better shooter scores more of their shots', () => {
    const [red, blue] = simulateMatch(MINUTES, { seed: 11, grades: { red: { outfielder: { shooting: 18 } }, blue: { outfielder: { shooting: 4 } } } })
    expect(conversion(red)).toBeGreaterThan(conversion(blue) + 0.15)
  })

  test('a quicker keeper concedes less of what is shot at them', () => {
    // Red's keeper faces Blue's shots. One a side, so more of the shots reach the keepers.
    const [red, blue] = simulateMatch(MINUTES, { seed: 11, outfielders: 1, grades: { red: { keeper: { reaction: 18 } }, blue: { keeper: { reaction: 4 } } } })
    expect(conversion(blue)).toBeLessThan(conversion(red) - 0.15)
  })

  test('every shot is accounted for, and both sides attack and win the ball back', () => {
    for (const s of simulateMatch(10, { seed: 5 })) {
      expect(s.goals + s.saved + s.missed).toBe(s.shots)
      expect(s.shots).toBeGreaterThan(5)
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

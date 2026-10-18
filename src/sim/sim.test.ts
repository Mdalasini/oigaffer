import { describe, expect, test } from 'bun:test'
import { BALL_RADIUS, GRAVITY } from './constants'
import { FULL_PITCH, SMALL_SIDED_PITCH } from './pitch'
import { reactionDelay, shotAngleError } from './grades'
import { createRng } from './rng'
import { launchVelocity, sampleShotTarget } from './shooting'
import { hasComponent } from 'bitecs'
import { Mark, OffBall, OnBall, Position, Pressing, Run, RunPhase } from './components'
import { createMatch, resetMatch, stepMatch, winBall } from './match'
import { simulateMatch } from './simulate'

// These scenes play on the default five-a-side pitch.
const GOAL_X = SMALL_SIDED_PITCH.halfLength

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
    // Over three ten-minute matches: one alone can leave a side with as few as two shots.
    const shots = [0, 0]
    const won = [0, 0]
    for (const seed of [5, 6, 7]) {
      simulateMatch(10, { seed }).forEach((s, team) => {
        expect(s.goals + s.saved + s.missed).toBe(s.shots)
        shots[team] += s.shots
        won[team] += s.won
      })
    }
    // Measured at 2–11 shots and 6–17 balls won a side in ten minutes, over ten seeds.
    for (const team of [0, 1]) {
      expect(shots[team]).toBeGreaterThan(6)
      expect(won[team]).toBeGreaterThan(9)
    }
  })

  test('eleven a side plays out on a full-size pitch: both sides attack, and everyone stays on it', () => {
    const world = createMatch({ outfielders: 10, seed: 2 })
    expect(world.teams[0].outfielders).toHaveLength(10)
    expect(world.pitch).toBe(FULL_PITCH)
    const { halfLength, halfWidth } = world.pitch
    let spread = 0
    let samples = 0
    while (world.time < 5 * 60) {
      stepMatch(world)
      // Chasing a ball that goes out, players can run on a few metres past the line before play stops them.
      for (const eid of [...world.teams[0].outfielders, ...world.teams[1].outfielders]) {
        expect(Math.abs(Position.x[eid])).toBeLessThan(halfLength + 6)
        expect(Math.abs(Position.y[eid])).toBeLessThan(halfWidth + 6)
      }
      if (world.phase !== 'play') continue
      const ys = world.teams[world.possession].outfielders.map((e) => Position.y[e])
      spread += Math.max(...ys) - Math.min(...ys)
      samples++
    }
    for (const s of world.stats) {
      expect(s.goals + s.saved + s.missed).toBeLessThanOrEqual(s.shots)
      expect(s.passes).toBeGreaterThan(10)
      expect(s.won).toBeGreaterThan(2)
    }
    // The side on the ball spreads across most of the pitch's width.
    expect(spread / samples).toBeGreaterThan(halfWidth)
  })

  test('five a side keeps its small pitch unless a match asks for another', () => {
    expect(createMatch({ seed: 1 }).pitch).toBe(SMALL_SIDED_PITCH)
    expect(createMatch({ seed: 1, outfielders: 4, pitch: FULL_PITCH }).pitch).toBe(FULL_PITCH)
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

  test('a turnover is announced once, with the new carrier and presser, and everyone reconsiders', () => {
    const world = createMatch({ outfielders: 4, seed: 3 })
    const red = world.carrier
    const blue = world.presser
    const cues: string[] = []
    world.onCue = (c) => cues.push(c.kind === 'carrier' || c.kind === 'presser' ? `${c.kind} ${c.player} from ${c.previous}` : c.kind)
    winBall(world, blue, 'tackled')
    // Blue was pressing and is now on the ball, so nobody is left pressing to step off.
    expect(cues).toEqual([`carrier ${blue} from ${red}`, 'possession', `presser ${red} from -1`])
    expect(world.nextMarking).toEqual([0, 0])
    for (const eid of [...world.teams[0].outfielders, ...world.teams[1].outfielders]) {
      if (eid !== blue && eid !== red) expect(OffBall.decideIn[eid]).toBeGreaterThanOrEqual(0.2)
    }
  })

  test('a restart while a pass is being shaped calls the pass off', () => {
    const world = createMatch({ outfielders: 4, seed: 3 })
    const cues: string[] = []
    while (!world.windup) stepMatch(world)
    world.onCue = (c) => cues.push(c.kind)
    resetMatch(world)
    expect(world.windup).toBeNull()
    expect(cues[0]).toBe('passCalledOff')
  })

  test('players far from the ball look again less often, and a pass struck makes everyone look sooner', () => {
    const world = createMatch({ outfielders: 4, seed: 6 })
    const near: number[] = []
    const far: number[] = []
    let struck = 0
    let justStruck = false
    // A pass struck or the ball changing hands has everyone look again soon: that's not a fresh look's wait.
    let cued = false
    world.onCue = (c) => {
      if (c.kind === 'passStruck') justStruck = true
      if (c.kind === 'passStruck' || c.kind === 'possession') cued = true
    }
    const before = new Map<number, number>()
    while (world.time < 10 * 60) {
      cued = false
      stepMatch(world)
      if (justStruck) {
        struck++
        justStruck = false
        for (const eid of [...world.teams[0].outfielders, ...world.teams[1].outfielders]) expect(OffBall.decideIn[eid]).toBeLessThanOrEqual(0.4)
      }
      for (const eid of [...world.teams[0].outfielders, ...world.teams[1].outfielders]) {
        const wait = OffBall.decideIn[eid]
        // A fresh look sets a new wait, longer than what was left.
        if (!cued && wait > (before.get(eid) ?? Infinity) + 0.05 && world.phase === 'play' && eid !== world.carrier && eid !== world.presser) {
          const distance = Math.hypot(Position.x[eid] - Position.x[world.ball], Position.y[eid] - Position.y[world.ball])
          if (distance < 8 && Mark.target[eid] === -1) near.push(wait)
          // Runners keep looking often, however far off they are.
          if (distance > 28 && Mark.target[eid] === -1 && !OffBall.showing[eid] && Run.phase[eid] === RunPhase.None) far.push(wait)
        }
        before.set(eid, wait)
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(struck).toBeGreaterThan(20)
    expect(near.length).toBeGreaterThan(50)
    expect(far.length).toBeGreaterThan(20)
    expect(mean(near)).toBeLessThan(0.5)
    expect(mean(far)).toBeGreaterThan(0.7)
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

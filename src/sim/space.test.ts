import { describe, expect, test } from 'bun:test'
import { Facing, Position, Velocity } from './components'
import { GOAL_X, PITCH_HALF_LENGTH, PITCH_HALF_WIDTH } from './constants'
import { createMatch, setVec, type GradeOverrides, type Match } from './match'
import { rollDistance, rollDistanceIn, rollTime } from './passing'
import { arrivalTime, REACTION_TIME } from './space/arrival'
import { controlAt, passSafety, timeOnBall } from './space/control'
import { shotChance, threat } from './space/threat'
import { BANDS, bandOf, laneOf, LANES, zoneCentre } from './space/zones'

const RED = 0
const BLUE = 1

/** Red's first outfielder at (x, y), Blue's at (bx, by), standing still and facing each other; the keepers on their lines. */
function placed(x: number, y: number, bx: number, by: number, grades: GradeOverrides = {}): Match {
  const world = createMatch({ outfielders: 2, seed: 1, grades })
  const red = world.teams[RED].outfielders[0]
  const blue = world.teams[BLUE].outfielders[0]
  for (const [eid, px, py, facing] of [
    [red, x, y, Math.atan2(by - y, bx - x)],
    [blue, bx, by, Math.atan2(y - by, x - bx)],
  ]) {
    setVec(Position, eid, px, py, 0)
    setVec(Velocity, eid, 0, 0, 0)
    Facing.angle[eid] = facing
  }
  // Everyone else is parked out of the way, in the corners.
  for (const team of [RED, BLUE]) {
    for (const eid of world.teams[team].outfielders.slice(1)) {
      setVec(Position, eid, (team === RED ? -1 : 1) * (PITCH_HALF_LENGTH - 1), PITCH_HALF_WIDTH - 1, 0)
      setVec(Velocity, eid, 0, 0, 0)
    }
  }
  setVec(Position, world.teams[RED].keeper, -GOAL_X + 0.5, 0, 0)
  setVec(Position, world.teams[BLUE].keeper, GOAL_X - 0.5, 0, 0)
  return world
}

describe('zones', () => {
  test('five lanes, mirrored about the middle', () => {
    expect(laneOf(0)).toBe(2)
    expect(laneOf(-PITCH_HALF_WIDTH)).toBe(0)
    expect(laneOf(PITCH_HALF_WIDTH)).toBe(LANES - 1)
    for (const y of [1, 4, 7, 10, 13]) expect(laneOf(-y)).toBe(LANES - 1 - laneOf(y))
  })

  test('bands count up from each team’s own goal', () => {
    expect(bandOf(-PITCH_HALF_LENGTH, RED)).toBe(0)
    expect(bandOf(PITCH_HALF_LENGTH, RED)).toBe(BANDS - 1)
    expect(bandOf(PITCH_HALF_LENGTH, BLUE)).toBe(0)
    const centre = zoneCentre(2, BANDS - 1, RED)
    expect(laneOf(centre.y)).toBe(2)
    expect(bandOf(centre.x, RED)).toBe(BANDS - 1)
    expect(zoneCentre(2, BANDS - 1, BLUE).x).toBeCloseTo(-centre.x, 6)
  })
})

describe('threat', () => {
  test('shot chances look like expected goals', () => {
    expect(shotChance(GOAL_X - 6, 0)).toBeGreaterThan(0.45)
    expect(shotChance(GOAL_X - 11, 0)).toBeGreaterThan(0.15)
    expect(shotChance(GOAL_X - 11, 0)).toBeLessThan(0.35)
    expect(shotChance(GOAL_X - 20, 0)).toBeLessThan(0.12)
  })

  test('rises towards goal and towards the middle, never below the shot itself', () => {
    for (let x = -PITCH_HALF_LENGTH + 2; x < GOAL_X - 2; x += 2) {
      expect(threat(RED, x + 2, 0)).toBeGreaterThan(threat(RED, x, 0))
      expect(threat(RED, x, 0)).toBeGreaterThan(threat(RED, x, 10))
      expect(threat(RED, x, 0)).toBeGreaterThanOrEqual(shotChance(x, 0) - 0.02)
    }
  })

  test('is the same for both teams, mirrored', () => {
    expect(threat(BLUE, -10, 3)).toBeCloseTo(threat(RED, 10, 3), 6)
    expect(threat(RED, 5, 4)).toBeCloseTo(threat(RED, 5, -4), 6)
  })
})

describe('roll timing', () => {
  test('agrees with the roll distance model', () => {
    const t = rollTime(12, 15)
    expect(rollDistanceIn(12, t)).toBeCloseTo(15, 4)
    expect(rollTime(5, rollDistance(5, 0) + 1)).toBe(Infinity)
  })
})

describe('arrival time', () => {
  // Component stores are shared between worlds, so each world is used up before the next is made.
  test('quicker for a faster player, and for one already heading that way', () => {
    const fast = placed(0, 0, 25, 0, { red: { outfielder: { pace: 20 } } })
    const quick = arrivalTime(fast, fast.teams[RED].outfielders[0], 20, 0)

    const world = placed(0, 0, 25, 0)
    const red = world.teams[RED].outfielders[0]
    const standing = arrivalTime(world, red, 20, 0)
    expect(quick).toBeLessThan(standing)
    setVec(Velocity, red, 6, 0, 0)
    expect(arrivalTime(world, red, 20, 0)).toBeLessThan(standing - 0.3)
    setVec(Velocity, red, -6, 0, 0)
    Facing.angle[red] = Math.PI
    expect(arrivalTime(world, red, 20, 0)).toBeGreaterThan(standing + 0.5)
  })

  test('a spot they run through while still reacting counts from the moment they reach it', () => {
    const world = placed(0, 0, 25, 0)
    const red = world.teams[RED].outfielders[0]
    setVec(Velocity, red, 8, 0, 0)
    expect(arrivalTime(world, red, 0.6, 0, 0.1)).toBeCloseTo(0.5 / 8, 3)
  })

  test('nothing for a spot already within reach, and little more than the reaction for one just beyond it', () => {
    const world = placed(0, 0, 25, 0)
    const red = world.teams[RED].outfielders[0]
    expect(arrivalTime(world, red, 0.5, 0, 0.6)).toBe(0)
    const justBeyond = arrivalTime(world, red, 0.5, 0, 0.3)
    expect(justBeyond).toBeGreaterThan(REACTION_TIME)
    expect(justBeyond).toBeLessThan(REACTION_TIME + 0.4)
  })
})

describe('control and passing lanes', () => {
  test('each team controls the space around its own player', () => {
    const world = placed(-5, 0, 5, 0)
    expect(controlAt(world, RED, -6, 0)).toBeGreaterThan(0.9)
    expect(controlAt(world, RED, 6, 0)).toBeLessThan(0.1)
    expect(controlAt(world, RED, 0, 0)).toBeCloseTo(0.5, 1)
  })

  test('a pass straight through an opponent is cut out; one well clear of them gets through', () => {
    const world = placed(-10, 0, 0, 0)
    expect(passSafety(world, RED, -10, 0, 10, 0, 14)).toBeLessThan(0.1)
    expect(passSafety(world, RED, -10, 0, -10, 12, 12)).toBeGreaterThan(0.9)
  })

  test('a pass that stops short of its target never gets there', () => {
    const world = placed(-10, 0, 10, 10)
    expect(passSafety(world, RED, -10, 0, 0, 0, 1)).toBe(0)
    expect(passSafety(world, RED, -10, 0, 10, 0, 4)).toBe(0)
  })

  test('a firmer pass gets past a nearby opponent more often than a soft one', () => {
    const world = placed(-10, 0, 0, 3)
    const soft = passSafety(world, RED, -10, 0, 10, 0, 9)
    const firm = passSafety(world, RED, -10, 0, 10, 0, 18)
    expect(firm).toBeGreaterThan(soft + 0.2)
  })

  test('the keeper only counts inside their own area', () => {
    const world = placed(0, 12, -15, 12)
    // A pass across the box in front of Blue's keeper is theirs to claim...
    expect(passSafety(world, RED, GOAL_X - 12, 0, GOAL_X - 3, 0, 9)).toBeLessThan(0.3)
    // ...but they can't come out for one in midfield.
    expect(passSafety(world, RED, -2, -4, 6, -4, 10)).toBeGreaterThan(0.9)
  })

  test('time on the ball shrinks as an opponent gets closer', () => {
    const far = placed(0, 0, 10, 0)
    const time = timeOnBall(far, far.teams[RED].outfielders[0])
    const near = placed(0, 0, 2, 0)
    expect(timeOnBall(near, near.teams[RED].outfielders[0])).toBeLessThan(time - 0.5)
  })
})

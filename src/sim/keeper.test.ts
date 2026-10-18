import { describe, expect, test } from 'bun:test'
import { hasComponent } from 'bitecs'
import { Defender, DefenderMode, Goalkeeper, Position, Sliding, Velocity } from './components'
import { BALL_RADIUS } from './constants'
import { SMALL_SIDED_PITCH } from './pitch'
import { createMatch, setVec, stepMatch, type GradeOverrides, type Match } from './match'
import { rollDistance, rollSpeedFor } from './passing'
import { startSlide } from './systems/defender'
import { shotUnderway } from './testUtils'
import { ballAtFeet } from './touch'

// These scenes play on the default five-a-side pitch.
const GOAL_X = SMALL_SIDED_PITCH.halfLength

const RED = 0
const BLUE = 1

/** Red shoots at Blue's keeper, who stands centrally on the line; the ball is struck 3 m out at `offset` across and `height` up. */
function shotAtKeeper(seed: number, offset: number, height: number, grades: GradeOverrides = {}): Match {
  const world = createMatch({ outfielders: 2, seed, grades })
  setVec(Position, world.carrier, 0, 10, 0)
  setVec(Position, world.presser, 0, -10, 0)
  setVec(Position, world.keeper, GOAL_X - 0.5, 0, 0)
  shotUnderway(world)
  setVec(Position, world.ball, GOAL_X - 3, offset, height)
  setVec(Velocity, world.ball, 25, 0, 0)
  for (let i = 0; i < 30 && world.phase === 'shot'; i++) stepMatch(world)
  return world
}

function caughtShare(handling: number, offset: number, height: number) {
  let caught = 0
  for (let seed = 1; seed <= 200; seed++) {
    if (shotAtKeeper(seed, offset, height, { blue: { keeper: { handling } } }).event?.kind === 'caught') caught++
  }
  return caught / 200
}

/** A seed in which the shot is held. */
function caughtShot(): Match {
  for (let seed = 1; ; seed++) {
    const world = shotAtKeeper(seed, 0.1, 1, { blue: { keeper: { handling: 20 } } })
    if (world.event?.kind === 'caught') return world
  }
}

describe('keeper handling', () => {
  test('better handling holds more shots, and stretching makes it harder', () => {
    expect(caughtShare(20, 0.1, 1)).toBeGreaterThan(caughtShare(1, 0.1, 1) + 0.4)
    expect(caughtShare(20, 1, 1)).toBeLessThan(caughtShare(20, 0.1, 1))
  })

  test('a ball above head height is always punched, never held', () => {
    expect(caughtShare(20, 0.1, 2.3)).toBe(0)
  })

  test('a parried shot stays in play, pushed away from goal, and the keeper cannot grab it straight back', () => {
    const world = shotAtKeeper(1, 0.1, 2.3)
    expect(world.event?.kind).toBe('parried')
    expect(world.phase).toBe('play')
    expect(Velocity.x[world.ball]).toBeLessThan(0)
    expect(Goalkeeper.recover[world.keeper]).toBeGreaterThan(0)
    expect(world.stats[RED].saved).toBe(1)
  })
})

describe('keeper distribution', () => {
  test('a caught shot gives the keeper’s team the ball, in the keeper’s hands', () => {
    const world = caughtShot()
    expect(world.phase).toBe('held')
    expect(world.possession).toBe(BLUE)
    expect(world.carrier).toBe(world.teams[BLUE].outfielders[0])
    expect(world.stats[RED].saved).toBe(1)
  })

  test('the keeper rolls it out to their outfielder once they have got open', () => {
    const world = caughtShot()
    const keeper = world.teams[BLUE].keeper
    const receiver = world.teams[BLUE].outfielders[0]
    for (let i = 0; i < 120 * 5 && world.phase === 'held'; i++) stepMatch(world)
    expect(world.phase).toBe('play')
    expect(world.lastTouchedBy).toBe(keeper)
    // Rolled along the ground towards the outfielder.
    const toReceiver = Math.atan2(Position.y[receiver] - Position.y[world.ball], Position.x[receiver] - Position.x[world.ball])
    expect(Position.z[world.ball]).toBeCloseTo(BALL_RADIUS, 6)
    expect(Math.abs(Math.atan2(Velocity.y[world.ball], Velocity.x[world.ball]) - toReceiver)).toBeLessThan(0.3)
    let received = false
    for (let i = 0; i < 120 * 4 && !received; i++) {
      stepMatch(world)
      received = ballAtFeet(receiver, world.ball)
    }
    expect(received).toBe(true)
  })
})

describe('a keeper with the ball in their hands', () => {
  test('lets an opponent who was sliding in finish the slide and get back up', () => {
    const world = caughtShot()
    const slider = world.presser
    Defender.readX[slider] = Position.x[slider] + 2
    Defender.readY[slider] = Position.y[slider]
    startSlide(world, slider)
    for (let i = 0; i < 120 * 3; i++) stepMatch(world)
    expect(hasComponent(world, slider, Sliding)).toBe(false)
    expect(Defender.mode[slider]).not.toBe(DefenderMode.Grounded)
  })
})

describe('back-passes', () => {
  /** A ball rolling gently into Blue's keeper's arms, last played by `by`. */
  function rollToKeeper(by: 'own' | 'opponent', deliberate: boolean): Match {
    const world = createMatch({ outfielders: 2, seed: 1 })
    setVec(Position, world.carrier, 0, 10, 0)
    setVec(Position, world.presser, 0, -10, 0)
    const keeper = world.teams[BLUE].keeper
    setVec(Position, keeper, GOAL_X - 0.5, 0, 0)
    setVec(Position, world.ball, GOAL_X - 3, 0, BALL_RADIUS)
    setVec(Velocity, world.ball, 3, 0, 0)
    world.lastTouchedBy = by === 'own' ? world.teams[BLUE].outfielders[0] : world.teams[RED].outfielders[0]
    world.lastTouchDeliberate = deliberate
    for (let i = 0; i < 120 && world.phase === 'play' && world.lastTouchedBy !== keeper; i++) stepMatch(world)
    return world
  }

  test('a keeper cannot pick up a ball their own outfielder played to them, so kicks it back out to them', () => {
    const world = rollToKeeper('own', true)
    const keeper = world.teams[BLUE].keeper
    const outfielder = world.teams[BLUE].outfielders[0]
    expect(world.event).toBeNull()
    expect(world.phase).toBe('play')
    expect(world.lastTouchedBy).toBe(keeper)
    // Played along the ground, back towards their outfielder rather than into the net.
    const toOutfielder = Math.atan2(Position.y[outfielder] - Position.y[world.ball], Position.x[outfielder] - Position.x[world.ball])
    expect(Math.abs(Math.atan2(Velocity.y[world.ball], Velocity.x[world.ball]) - toOutfielder)).toBeLessThan(0.3)
  })

  test('but can gather one from the opposition, or a deflection off their own player', () => {
    expect(rollToKeeper('opponent', true).event?.kind).toBe('claimed')
    expect(rollToKeeper('own', false).event?.kind).toBe('claimed')
  })
})

describe('rolled passes', () => {
  test('arrive at the speed they were weighted for', () => {
    for (const distance of [5, 12, 25]) {
      const speed = rollSpeedFor(distance, 3.5)
      expect(rollDistance(speed, 3.5)).toBeCloseTo(distance, 3)
    }
  })
})

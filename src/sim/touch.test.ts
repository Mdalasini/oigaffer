import { describe, expect, test } from 'bun:test'
import { angleDelta } from './angles'
import { Dribbler, Facing, Position, TouchStyle, Velocity } from './components'
import { FIXED_DT } from './constants'
import { createMatch, setVec, stepMatch, type Match } from './match'
import { ballSystem } from './systems/ball'
import { locomotionSystem } from './systems/locomotion'
import { touchCooldownSystem, touchSystem } from './systems/touch'
import { dribble, FOOT_OFFSET } from './touch'

/** A carrier in open grass with the ball at its feet, running along +x at `speed`. */
function setup(seed: number, speed = 0, dribbling = 13): Match {
  const world = createMatch({ seed, grades: { red: { outfielder: { dribbling, pace: 14 } } } })
  const { carrier, ball } = world
  setVec(Position, carrier, -20, 0, 0)
  setVec(Velocity, carrier, speed, 0, 0)
  Facing.angle[carrier] = 0
  setVec(Position, ball, -20 + FOOT_OFFSET + 0.1, 0, Position.z[ball])
  setVec(Velocity, ball, speed, 0, 0)
  return world
}

function tick(world: Match) {
  touchCooldownSystem(world, FIXED_DT)
  touchSystem(world, FIXED_DT)
  locomotionSystem(world, FIXED_DT)
  ballSystem(world, FIXED_DT)
}

/** Dribbles along +x for `seconds`; returns the widest player–ball gap and the distance run. */
function run(style: TouchStyle, seconds: number) {
  const world = setup(1)
  const { carrier, ball } = world
  let maxGap = 0
  const steps = Math.round(seconds / FIXED_DT)
  for (let i = 0; i < steps; i++) {
    dribble(carrier, ball, style, 1, 0)
    tick(world)
    // Ignore the first second while the player gets going.
    if (i * FIXED_DT > 1) maxGap = Math.max(maxGap, Math.hypot(Position.x[ball] - Position.x[carrier], Position.y[ball] - Position.y[carrier]))
  }
  return { maxGap, distance: Position.x[carrier] + 20 }
}

/** Plays one touch towards `dir` (radians) and returns the ball's heading. */
function touchHeading(style: TouchStyle, dir: number, seed: number, dribbling = 13) {
  const world = setup(seed, 5, dribbling)
  const { carrier, ball } = world
  Dribbler.style[carrier] = style
  Dribbler.dirX[carrier] = Math.cos(dir)
  Dribbler.dirY[carrier] = Math.sin(dir)
  touchSystem(world, FIXED_DT)
  return Math.atan2(Velocity.y[ball], Velocity.x[ball])
}

describe('touches', () => {
  test('small touches keep the ball closer; large touches cover more ground', () => {
    const small = run(TouchStyle.Small, 6)
    const large = run(TouchStyle.Large, 6)
    expect(small.maxGap).toBeLessThan(2)
    expect(large.maxGap).toBeGreaterThan(small.maxGap * 1.5)
    expect(large.distance).toBeGreaterThan(small.distance + 5)
  })

  test('a small touch can take the ball sideways; a large touch only goes roughly forwards', () => {
    const square = Math.PI / 2
    const small = touchHeading(TouchStyle.Small, square, 2, 20)
    const large = touchHeading(TouchStyle.Large, square, 2, 20)
    expect(Math.abs(angleDelta(small, square))).toBeLessThan(0.15)
    expect(large).toBeLessThan(1)
  })

  test('better dribblers put the ball where they mean to', () => {
    const meanError = (dribbling: number) => {
      let sum = 0
      for (let seed = 1; seed <= 200; seed++) sum += Math.abs(touchHeading(TouchStyle.Small, 0.3, seed, dribbling) - 0.3)
      return sum / 200
    }
    expect(meanError(20)).toBeLessThan(meanError(1) / 3)
  })

  test('no touch is played when the ball is out of reach', () => {
    const world = setup(3)
    const { carrier, ball } = world
    setVec(Position, ball, -15, 0, Position.z[ball])
    Dribbler.style[carrier] = TouchStyle.Small
    Dribbler.dirX[carrier] = 1
    Dribbler.dirY[carrier] = 0
    touchSystem(world, FIXED_DT)
    expect(Velocity.x[ball]).toBe(0)
    expect(world.lastTouch).toBeNull()
  })

  test('a shot takes priority over a touch when both become ready on the same tick', () => {
    const world = setup(5)
    const { carrier } = world
    world.shootRequested = true
    Facing.angle[carrier] = 0
    Dribbler.cooldown[carrier] = FIXED_DT / 2
    stepMatch(world)
    expect(world.phase).toBe('shot')
    expect(world.lastTouch).toBeNull()
  })

  test('the carrier never shoots without the ball at its feet', () => {
    // Any shot origin must be within touching distance of the carrier's feet.
    const world = createMatch({ seed: 4 })
    const totalShots = () => world.stats[0].shots + world.stats[1].shots
    let shots = 0
    let lastShots = 0
    for (let i = 0; i < 120 * 300 && shots < 10; i++) {
      const before = { x: Position.x[world.ball], y: Position.y[world.ball] }
      const footX = Position.x[world.carrier] + Math.cos(Facing.angle[world.carrier]) * FOOT_OFFSET
      const footY = Position.y[world.carrier] + Math.sin(Facing.angle[world.carrier]) * FOOT_OFFSET
      stepMatch(world)
      if (totalShots() !== lastShots) {
        lastShots = totalShots()
        // A ball rolled into the net counts as a shot too, but nobody struck it.
        if (world.phase !== 'shot') continue
        shots++
        expect(Math.hypot(before.x - footX, before.y - footY)).toBeLessThanOrEqual(0.6 + 1e-6)
      }
    }
    expect(shots).toBe(10)
  })
})

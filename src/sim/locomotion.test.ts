import { describe, expect, test } from 'bun:test'
import { addComponent, addEntity, createWorld, type World } from 'bitecs'
import { angleDelta } from './angles'
import { Facing, MoveIntent, Physical, Position, Velocity } from './components'
import { FIXED_DT } from './constants'
import { accelerationRate, sideStepSpeed, topSpeed } from './grades'
import { locomotionSystem } from './systems/locomotion'

function player(world: World, { pace = 10, acceleration = 10, agility = 10 } = {}) {
  const eid = addEntity(world)
  for (const c of [Position, Velocity, Facing, MoveIntent, Physical]) addComponent(world, eid, c)
  Position.x[eid] = Position.y[eid] = Velocity.x[eid] = Velocity.y[eid] = Facing.angle[eid] = 0
  Physical.pace[eid] = pace
  Physical.acceleration[eid] = acceleration
  Physical.agility[eid] = agility
  want(eid, 0, 0)
  return eid
}

function want(eid: number, vx: number, vy: number, faceX = 0, faceY = 0) {
  MoveIntent.vx[eid] = vx
  MoveIntent.vy[eid] = vy
  MoveIntent.faceX[eid] = faceX
  MoveIntent.faceY[eid] = faceY
}

const speedOf = (eid: number) => Math.hypot(Velocity.x[eid], Velocity.y[eid])

/** Steps until `done` holds; returns the seconds it took. */
function timeUntil(world: World, done: () => boolean, limit = 10) {
  let t = 0
  while (!done() && t < limit) {
    locomotionSystem(world, FIXED_DT)
    t += FIXED_DT
  }
  return t
}

/** A player already running flat out along +x at `speed`. */
function runningAt(world: World, speed: number, grades = {}) {
  const eid = player(world, grades)
  Velocity.x[eid] = speed
  want(eid, speed, 0)
  return eid
}

describe('locomotion', () => {
  test('players never run faster than their top speed', () => {
    const world = createWorld()
    const eid = player(world, { pace: 20 })
    want(eid, 50, 0)
    timeUntil(world, () => false, 5)
    expect(speedOf(eid)).toBeCloseTo(topSpeed(20), 3)
  })

  test('running on a diagonal is still capped at top speed', () => {
    const world = createWorld()
    const eid = player(world, { pace: 1, agility: 20 })
    want(eid, 50, 50, 1, 0)
    timeUntil(world, () => false, 5)
    expect(speedOf(eid)).toBeCloseTo(topSpeed(1), 3)
  })

  test('a reversal brakes to a stop, then accelerates for the rest of the step', () => {
    const world = createWorld()
    const eid = player(world, { acceleration: 20, agility: 20 })
    Velocity.x[eid] = 0.01
    want(eid, -10, 0, 1, 0)
    locomotionSystem(world, FIXED_DT)
    const accel = accelerationRate(20)
    const brakingTime = 0.01 / (accel * 1.6)
    expect(Velocity.x[eid]).toBeCloseTo(-accel * (FIXED_DT - brakingTime), 6)
  })

  test('turning takes longer at speed', () => {
    const turnTime = (speed: number) => {
      const world = createWorld()
      const eid = runningAt(world, speed)
      want(eid, 0, speed)
      return timeUntil(world, () => Math.abs(angleDelta(Facing.angle[eid], Math.PI / 2)) < 0.05)
    }
    expect(turnTime(8)).toBeGreaterThan(turnTime(2) * 2)
  })

  test('agile players turn quicker', () => {
    const turnTime = (agility: number) => {
      const world = createWorld()
      const eid = runningAt(world, 6, { agility })
      want(eid, 0, 6)
      return timeUntil(world, () => Math.abs(angleDelta(Facing.angle[eid], Math.PI / 2)) < 0.05)
    }
    expect(turnTime(20)).toBeLessThan(turnTime(1))
  })

  test('sidestepping is capped well below running speed', () => {
    const world = createWorld()
    const eid = player(world, { pace: 20, agility: 20 })
    want(eid, 0, 10, 1, 0)
    timeUntil(world, () => false, 3)
    expect(Facing.angle[eid]).toBeCloseTo(0, 5)
    expect(speedOf(eid)).toBeCloseTo(sideStepSpeed(20), 3)
    expect(sideStepSpeed(20)).toBeLessThan(topSpeed(1))
  })

  test('reversing at a sprint is slower than setting off from standing', () => {
    const fromStanding = (() => {
      const world = createWorld()
      const eid = player(world)
      want(eid, -6, 0)
      return timeUntil(world, () => Velocity.x[eid] < -5)
    })()
    const fromSprint = (() => {
      const world = createWorld()
      const eid = runningAt(world, 8)
      want(eid, -6, 0)
      return timeUntil(world, () => Velocity.x[eid] < -5)
    })()
    expect(fromSprint).toBeGreaterThan(fromStanding + 1)
  })
})

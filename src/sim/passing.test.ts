import { describe, expect, test } from 'bun:test'
import { Facing, Outfielder, Position, Velocity } from './components'
import { BALL_RADIUS, GOAL_X } from './constants'
import { createMatch, handOver, setVec, stepMatch, type GradeOverrides, type Match } from './match'
import { rollSpeedAfter, rollSpeedToArrive, rollTime } from './passing'
import { choosePass, passOptions, strikePass } from './playmaking'
import { passToOutfielder } from './systems/keeper'
import { CONTROL_RADIUS, footDistance, FOOT_OFFSET } from './touch'

const RED = 0
const BLUE = 1

function place(eid: number, x: number, y: number, facing = 0) {
  setVec(Position, eid, x, y, 0)
  setVec(Velocity, eid, 0, 0, 0)
  Facing.angle[eid] = facing
}

/**
 * Red's first outfielder on the ball at (x, y) facing +x, their teammate at
 * (mx, my), and Blue's outfielders wherever given (otherwise back by their own
 * goal, out wide).
 */
function scene(seed: number, x: number, y: number, mx: number, my: number, blue: [number, number][] = [], grades: GradeOverrides = {}): Match {
  const world = createMatch({ outfielders: 2, seed, grades })
  const [carrier, mate] = world.teams[RED].outfielders
  handOver(world, carrier)
  place(carrier, x, y)
  setVec(Position, world.ball, x + FOOT_OFFSET, y, BALL_RADIUS)
  setVec(Velocity, world.ball, 0, 0, 0)
  place(mate, mx, my, Math.PI)
  const spots: [number, number][] = [...blue, [20, 14], [20, -14]]
  world.teams[BLUE].outfielders.forEach((eid, i) => place(eid, spots[i][0], spots[i][1], Math.PI))
  return world
}

describe('weighting a pass', () => {
  test('a ball struck to arrive in a given time does, and slows as it goes', () => {
    const speed = rollSpeedToArrive(20, 2)
    expect(rollTime(speed, 20)).toBeCloseTo(2, 2)
    expect(rollSpeedAfter(speed, 2)).toBeLessThan(speed)
    expect(rollSpeedToArrive(80, 1)).toBe(Infinity)
  })
})

describe('passes to feet', () => {
  test('reach a free teammate, who brings it under control', () => {
    const world = scene(1, -10, 0, 5, 3, [], { red: { outfielder: { passing: 20, firstTouch: 20 } } })
    const [, mate] = world.teams[RED].outfielders
    const option = passOptions(world, world.carrier).find((o) => o.receiver === mate && o.kind === 'feet')!
    expect(option.safety).toBeGreaterThan(0.95)
    strikePass(world, world.carrier, option)
    expect(world.carrier).toBe(mate)
    for (let i = 0; i < 3 * 120 && world.stats[RED].completed === 0; i++) stepMatch(world)
    expect(world.pass).toBeNull()
    expect(world.stats[RED].completed).toBe(1)
    expect(world.carrier).toBe(mate)
    expect(footDistance(mate, world.ball)).toBeLessThan(CONTROL_RADIUS)
  })

  test('are cut out by an opponent standing in the way', () => {
    const world = scene(2, -10, 0, 8, 0, [[-1, 0.3]])
    const [, mate] = world.teams[RED].outfielders
    const option = passOptions(world, world.carrier).find((o) => o.receiver === mate && o.kind === 'feet')!
    expect(option.safety).toBeLessThan(0.2)
    strikePass(world, world.carrier, option)
    // The defender gets to it first, whoever ends up with the loose ball.
    const defender = world.teams[BLUE].outfielders[0]
    let touched = false
    for (let i = 0; i < 3 * 120 && world.phase === 'play' && !touched; i++) {
      stepMatch(world)
      touched = world.lastTouchedBy === defender
    }
    expect(touched).toBe(true)
    expect(world.stats[RED].completed).toBe(0)
  })
})

describe('through balls', () => {
  test('are played into space ahead of the receiver, who runs onto them', () => {
    const world = scene(3, -12, -4, -2, 4, [], { red: { outfielder: { passing: 20, firstTouch: 20 } } })
    const [, mate] = world.teams[RED].outfielders
    const option = passOptions(world, world.carrier)
      .filter((o) => o.receiver === mate && o.kind === 'through')
      .sort((a, b) => b.value - a.value)[0]
    const startX = Position.x[mate]
    strikePass(world, world.carrier, option)
    for (let i = 0; i < 4 * 120 && world.stats[RED].completed === 0; i++) stepMatch(world)
    expect(world.stats[RED].completed).toBe(1)
    expect(world.carrier).toBe(mate)
    // They met it out in front of where they started, near where it was aimed.
    expect(Position.x[mate]).toBeGreaterThan(startX + 2)
    expect(Math.hypot(Position.x[mate] - option.x, Position.y[mate] - option.y)).toBeLessThan(4)
  })
})

describe('getting a pass away', () => {
  test('the passer can’t take back a soft pass on its way out', () => {
    const world = scene(7, -10, 0, -4, 0)
    const [passer, mate] = world.teams[RED].outfielders
    setVec(Velocity, passer, 3, 0, 0)
    strikePass(world, passer, { receiver: mate, kind: 'feet', x: -4, y: 0, speed: 4, safety: 1, value: 1 })
    for (let i = 0; i < 20; i++) stepMatch(world)
    expect(world.pass?.to).toBe(mate)
    expect(world.carrier).toBe(mate)
  })

  test('a pass across the body doesn’t hit the passer', () => {
    const world = scene(8, -10, 0, -14, 7, [], { red: { outfielder: { passing: 20 } } })
    const [passer, mate] = world.teams[RED].outfielders
    // Facing +x, passing back and to the side.
    strikePass(world, passer, { receiver: mate, kind: 'feet', x: -14, y: 7, speed: 9, safety: 1, value: 1 })
    for (let i = 0; i < 20; i++) stepMatch(world)
    expect(world.pass?.to).toBe(mate)
  })

  test('a keeper kicking out a pass meant for a teammate starts a new one', () => {
    const world = scene(9, -10, 0, -4, 0)
    const [passer, mate] = world.teams[RED].outfielders
    const keeper = world.teams[RED].keeper
    world.pass = { from: passer, to: mate, kind: 'through', x: 20, y: 0, time: world.time }
    handOver(world, mate)
    passToOutfielder(world, keeper, mate, Position.x[keeper], Position.y[keeper])
    expect(world.pass).toBeNull()
    expect(world.carrier).toBe(mate)
  })
})

describe('first touch', () => {
  /** A set first touch leaves the ball moving at most this fast (m/s) relative to the receiver. */
  const SET_PACE = 2.5

  /**
   * Share of passes, rolled at the receiver at `speed`, that their first
   * touch sets: the ball comes off them no faster than a controlled touch.
   */
  function controlled(firstTouch: number, speed: number) {
    let kept = 0
    for (let seed = 1; seed <= 60; seed++) {
      const world = scene(seed, -15, 10, 0, 0, [], { red: { outfielder: { firstTouch } } })
      const [passer, mate] = world.teams[RED].outfielders
      place(passer, -20, 10)
      Facing.angle[mate] = Math.PI
      setVec(Position, world.ball, -3, 0, BALL_RADIUS)
      setVec(Velocity, world.ball, speed, 0, 0)
      world.pass = { from: passer, to: mate, kind: 'feet', x: 0, y: 0, time: world.time }
      handOver(world, mate)
      world.stats[RED].passes++
      for (let i = 0; i < 90 && world.stats[RED].completed === 0; i++) stepMatch(world)
      // Straight after the touch: a ball set at their feet moves with them; a heavy one runs away.
      const away = Math.hypot(Velocity.x[world.ball] - Velocity.x[mate], Velocity.y[world.ball] - Velocity.y[mate])
      if (world.stats[RED].completed === 1 && away < SET_PACE) kept++
    }
    return kept / 60
  }

  test('a good first touch tames a fast ball that a poor one lets get away', () => {
    expect(controlled(20, 15)).toBeGreaterThan(controlled(1, 15) + 0.3)
  })

  test('a gentle pass is easy for anyone', () => {
    expect(controlled(1, 5)).toBeGreaterThan(0.8)
  })
})

describe('choosing a pass', () => {
  test('a carrier hemmed in near their own goal finds a free teammate', () => {
    const grades = { red: { outfielder: { decisions: 20, vision: 20 } } }
    const world = scene(4, -GOAL_X + 6, 8, -4, -6, [[-GOAL_X + 7.2, 8.4], [-GOAL_X + 4.5, 6]], grades)
    expect(choosePass(world, world.carrier)?.receiver).toBe(world.teams[RED].outfielders[1])
  })

  test('a carrier with the goal at their mercy keeps it', () => {
    const grades = { red: { outfielder: { decisions: 20, vision: 20 } } }
    const world = scene(5, GOAL_X - 9, 0, -5, 10, [], grades)
    expect(choosePass(world, world.carrier)).toBeNull()
  })

  test('better vision spots more of the teammates over their shoulder', () => {
    const spotted = (vision: number) => {
      // Behind and to the side: outside their field of view, but a pass they could play.
      const world = scene(6, 0, 0, -6, 8, [], { red: { outfielder: { vision } } })
      Outfielder.vision[world.carrier] = vision
      let seen = 0
      for (let i = 0; i < 200; i++) if (passOptions(world, world.carrier).length > 0) seen++
      return seen / 200
    }
    expect(spotted(20)).toBeGreaterThan(spotted(1) + 0.4)
  })
})

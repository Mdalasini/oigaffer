import { describe, expect, test } from 'bun:test'
import { Dribbler, Facing, Passer, Position, Run, RunPhase, Velocity } from './components'
import { BALL_RADIUS, MAX_GRADE } from './constants'
import { topSpeed } from './grades'
import { FULL_PITCH, SMALL_SIDED_PITCH } from './pitch'
import { createMatch, handOver, setVec, stepMatch, type GradeOverrides, type Match } from './match'
import { rollDistance, rollDistanceIn, rollSpeedAfter, rollSpeedFor, rollSpeedToArrive, rollStopTime, rollTime } from './passing'
import { lookAround } from './perception'
import { choosePass, passOptions, returnCost, strikePass } from './playmaking'
import { passToOutfielder } from './systems/keeper'
import { CONTROL_RADIUS, footDistance, FOOT_OFFSET } from './touch'

// These scenes play on the default five-a-side pitch.
const GOAL_X = SMALL_SIDED_PITCH.halfLength

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
  // Everyone has had a look at where everyone else has been put.
  lookAround(world)
  return world
}

describe('weighting a pass', () => {
  test('a ball struck to arrive in a given time does, and slows as it goes', () => {
    const speed = rollSpeedToArrive(20, 2)
    expect(rollTime(speed, 20)).toBeCloseTo(2, 2)
    expect(rollSpeedAfter(speed, 2)).toBeLessThan(speed)
    expect(rollSpeedToArrive(80, 1)).toBe(Infinity)
  })

  test('a pass along the ground to a teammate standing still, to feet or into space, outruns the fastest player', () => {
    const world = scene(4, -10, -6, 8, 8)
    const [, mate] = world.teams[RED].outfielders
    const bx = Position.x[world.ball]
    const by = Position.y[world.ball]
    const options = passOptions(world, world.carrier).filter((o) => o.receiver === mate && o.flight === 0)
    expect(options.some((o) => o.kind === 'feet')).toBe(true)
    expect(options.some((o) => o.kind === 'through')).toBe(true)
    for (const o of options) {
      const distance = Math.hypot(o.x - bx, o.y - by)
      // Over the whole way, well quicker than anyone can sprint, so a chaser can't simply run it down.
      expect(distance / rollTime(o.speed, distance)).toBeGreaterThan(1.15 * topSpeed(MAX_GRADE))
    }
  })
})

describe('the rolling ball, worked backwards', () => {
  test('each inverse lands on its forward model, across the range of passes', () => {
    for (const distance of [0.5, 3, 8, 15, 25, 35]) {
      for (const arrival of [0, 1.5, 6]) expect(rollDistance(rollSpeedFor(distance, arrival), arrival)).toBeCloseTo(distance, 6)
      for (const from of [4, 10, 20, 30]) {
        const t = rollTime(from, distance)
        if (t === Infinity) expect(rollDistanceIn(from, rollStopTime(from))).toBeLessThan(distance)
        else expect(rollDistanceIn(from, t)).toBeCloseTo(distance, 6)
        // Starting from the time to somewhere nearer gives the same answer.
        if (t !== Infinity) expect(rollTime(from, distance, rollTime(from, distance / 2))).toBeCloseTo(t, 9)
      }
      for (const time of [0.8, 2, 4, 8]) {
        const speed = rollSpeedToArrive(distance, time)
        if (speed !== Infinity) expect(rollTime(speed, distance)).toBeLessThanOrEqual(time + 1e-6)
      }
    }
  })

  test('however long there is, a pass that can get there at all is given a speed that does', () => {
    // Plenty of time for 10 m; and 120 m, which needs more than the 40 m/s cap on paced passes but not the 60 m/s limit.
    for (const [distance, time] of [[10, 100], [120, 20]]) {
      const speed = rollSpeedToArrive(distance, time)
      expect(speed).toBeLessThan(Infinity)
      expect(rollTime(speed, distance)).toBeLessThanOrEqual(time)
    }
  })

  test('a ball that would have to stop first is struck just hard enough to get there', () => {
    // Twenty seconds for 10 m: any ball that slow stops sooner, so it's the gentlest that reaches at all.
    const speed = rollSpeedToArrive(10, 20)
    expect(speed).toBeCloseTo(rollSpeedFor(10, 0), 6)
    expect(rollTime(speed * 1.001, 10)).toBeLessThan(20)
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
    strikePass(world, passer, { receiver: mate, kind: 'feet', x: -4, y: 0, speed: 4, flight: 0, safety: 1, value: 1 })
    for (let i = 0; i < 20; i++) stepMatch(world)
    expect(world.pass?.to).toBe(mate)
    expect(world.carrier).toBe(mate)
  })

  test('a pass across the body doesn’t hit the passer', () => {
    const world = scene(8, -10, 0, -14, 7, [], { red: { outfielder: { passing: 20 } } })
    const [passer, mate] = world.teams[RED].outfielders
    // Facing +x, passing back and to the side.
    strikePass(world, passer, { receiver: mate, kind: 'feet', x: -14, y: 7, speed: 9, flight: 0, safety: 1, value: 1 })
    for (let i = 0; i < 20; i++) stepMatch(world)
    expect(world.pass?.to).toBe(mate)
  })

  test('a keeper kicking out a pass meant for a teammate starts a new one', () => {
    const world = scene(9, -10, 0, -4, 0)
    const [passer, mate] = world.teams[RED].outfielders
    const keeper = world.teams[RED].keeper
    world.pass = { from: passer, to: mate, kind: 'through', lofted: false, x: 20, y: 0, time: world.time }
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
      world.pass = { from: passer, to: mate, kind: 'feet', lofted: false, x: 0, y: 0, time: world.time }
      handOver(world, mate)
      world.stats[RED].passes++
      for (let i = 0; i < 90 && world.stats[RED].completed === 0; i++) stepMatch(world)
      // Straight after the touch: a ball set at their feet moves with them; a heavy one runs away.
      const away = Math.hypot(Velocity.x[world.ball] - Velocity.x[mate], Velocity.y[world.ball] - Velocity.y[mate])
      if (world.stats[RED].completed === 1 && away < SET_PACE) kept++
    }
    return kept / 60
  }

  test('every first touch sets the ball, however hard it comes and whoever takes it', () => {
    expect(controlled(1, 15)).toBeGreaterThan(0.95)
    expect(controlled(1, 5)).toBeGreaterThan(0.95)
  })

  test('a better first touch is ready to play it again sooner', () => {
    expect(readyAfter(20)).toBeLessThan(0.05)
    expect(readyAfter(1)).toBeLessThan(0.2)
    expect(readyAfter(1)).toBeGreaterThan(readyAfter(20) + 0.1)
  })

  /** Seconds from the first touch until the receiver could play the ball again. */
  function readyAfter(firstTouch: number) {
    const world = scene(1, -15, 10, 0, 0, [], { red: { outfielder: { firstTouch } } })
    const [passer, mate] = world.teams[RED].outfielders
    place(passer, -20, 10)
    Facing.angle[mate] = Math.PI
    setVec(Position, world.ball, -3, 0, BALL_RADIUS)
    setVec(Velocity, world.ball, 8, 0, 0)
    world.pass = { from: passer, to: mate, kind: 'feet', lofted: false, x: 0, y: 0, time: world.time }
    handOver(world, mate)
    for (let i = 0; i < 90 && world.stats[RED].completed === 0; i++) stepMatch(world)
    return Dribbler.cooldown[mate]
  }
})

describe('first time', () => {
  /**
   * Share of 60 seeds in which a pass rolled to Red's second outfielder, with
   * a teammate free alongside and a defender `gap` m off them, is played on
   * first time: struck again the moment it arrives, with no touch to control it.
   */
  function firstTime(gap: number) {
    let n = 0
    for (let seed = 1; seed <= 60; seed++) {
      const world = createMatch({ outfielders: 4, seed })
      const [passer, receiver, free, away] = world.teams[RED].outfielders
      place(passer, -15, 0)
      place(receiver, 0, 0, Math.PI)
      place(free, 2, 12, Math.PI)
      place(away, -25, -15)
      const [defender, ...rest] = world.teams[BLUE].outfielders
      place(defender, gap, -0.5, Math.PI)
      rest.forEach((eid, i) => place(eid, 25, 15 - 15 * i, Math.PI))
      setVec(Position, world.ball, -4, 0, BALL_RADIUS)
      setVec(Velocity, world.ball, 8, 0, 0)
      lookAround(world)
      world.pass = { from: passer, to: receiver, kind: 'feet', lofted: false, x: 0, y: 0, time: world.time }
      handOver(world, receiver)
      for (let i = 0; i < 90 && world.stats[RED].completed === 0; i++) stepMatch(world)
      if (world.stats[RED].completed === 1 && world.pass?.from === receiver) n++
    }
    return n / 60
  }

  test('closed down as the ball arrives, with a teammate free, a receiver often plays it on first time', () => {
    expect(firstTime(1.5)).toBeGreaterThan(0.3)
  })

  test('with time on the ball, they take a touch to control it first', () => {
    expect(firstTime(15)).toBeLessThan(0.1)
  })
})

describe('choosing a pass', () => {
  test('a pass straight back to whoever just played it is a last resort, when another teammate is as free', () => {
    let back = 0
    let passes = 0
    for (let seed = 1; seed <= 100; seed++) {
      const world = createMatch({ outfielders: 4, seed, grades: { red: { outfielder: { decisions: 20 } } } })
      const [carrier, from, other, away] = world.teams[RED].outfielders
      handOver(world, carrier)
      place(carrier, 0, 0)
      setVec(Position, world.ball, FOOT_OFFSET, 0, BALL_RADIUS)
      setVec(Velocity, world.ball, 0, 0, 0)
      place(from, -6, 9, 0)
      place(other, -6, -9, 0)
      place(away, -25, 15, 0)
      const [presser, ...rest] = world.teams[BLUE].outfielders
      place(presser, 1.5, 0, Math.PI)
      rest.forEach((eid, i) => place(eid, 25, 15 - 30 * i, Math.PI))
      lookAround(world)
      Passer.receivedFrom[carrier] = from
      Passer.receivedAt[carrier] = world.time
      const pass = choosePass(world, carrier)
      if (!pass) continue
      passes++
      if (pass.receiver === from) back++
    }
    expect(passes).toBeGreaterThan(50)
    expect(back / passes).toBeLessThan(0.2)
  })

  test('pressed deep in their own half, two players stop knocking it between themselves after a few passes', () => {
    /** How often they give it straight back, after `exchanges` passes in a row between the two of them. */
    const backShare = (exchanges: number) => {
      let back = 0
      for (let seed = 1; seed <= 60; seed++) {
        const world = createMatch({ outfielders: 4, seed, grades: { red: { outfielder: { decisions: 20 } } } })
        const [carrier, from, ahead, wide] = world.teams[RED].outfielders
        handOver(world, carrier)
        place(carrier, -18, 0)
        setVec(Position, world.ball, -18 + FOOT_OFFSET, 0, BALL_RADIUS)
        setVec(Velocity, world.ball, 0, 0, 0)
        place(from, -17, -14, 0)
        place(ahead, -4, 2, 0)
        place(wide, -2, 14, 0)
        // One presses the carrier and one waits upfield of the other back player; the rest mark tight, goal-side.
        const [presser, screen, onAhead, onWide] = world.teams[BLUE].outfielders
        place(presser, -15, -1, Math.PI)
        place(screen, -8, -10, Math.PI)
        place(onAhead, -5, 2, Math.PI)
        place(onWide, 0, 13, Math.PI)
        lookAround(world)
        Passer.receivedFrom[carrier] = from
        Passer.receivedAt[carrier] = world.time
        Passer.exchanges[carrier] = exchanges
        if (choosePass(world, carrier)?.receiver === from) back++
      }
      return back / 60
    }
    // The pass back is their safest option, and the first few are free; by the sixth they keep it or look forward.
    expect(backShare(1)).toBeGreaterThan(0.8)
    expect(backShare(2)).toBeGreaterThan(0.8)
    expect(backShare(6)).toBeLessThan(0.2)
  })

  test('every pass back to whoever just played it is marked down alike, so a worse one never looks better', () => {
    const world = scene(1, 0, 0, -5, 7)
    const [carrier, from] = world.teams[RED].outfielders
    Passer.receivedFrom[carrier] = from
    Passer.receivedAt[carrier] = world.time
    // Those that move the ball on, as a one-two does, aren't marked down at all.
    const costs = passOptions(world, carrier)
      .filter((o) => o.receiver === from)
      .map((o) => returnCost(world, carrier, o))
      .filter((cost) => cost > 0)
    expect(costs.length).toBeGreaterThan(1)
    for (const cost of costs) expect(cost).toBeCloseTo(costs[0], 9)
  })

  test('on a full-size pitch, a free teammate 45 m away is an option', () => {
    const world = createMatch({ outfielders: 2, seed: 1, pitch: FULL_PITCH })
    const [carrier, mate] = world.teams[RED].outfielders
    handOver(world, carrier)
    place(carrier, -30, 0)
    setVec(Position, world.ball, -30 + FOOT_OFFSET, 0, BALL_RADIUS)
    setVec(Velocity, world.ball, 0, 0, 0)
    place(mate, 15, 0, Math.PI)
    world.teams[BLUE].outfielders.forEach((eid, i) => place(eid, 40, 25 - 50 * i, Math.PI))
    lookAround(world)
    expect(passOptions(world, carrier).some((o) => o.receiver === mate && o.kind === 'feet')).toBe(true)
  })

  test('having passed it, a player moves on into the space ahead rather than standing where they played it', () => {
    const world = scene(1, -10, 0, -2, 8)
    const [carrier, mate] = world.teams[RED].outfielders
    const option = passOptions(world, carrier).find((o) => o.receiver === mate && o.kind === 'feet')!
    strikePass(world, carrier, option)
    expect(Run.phase[carrier]).toBe(RunPhase.Go)
    expect(Run.targetX[carrier]).toBeGreaterThan(-10 + 5)
  })

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

  test('a teammate the carrier has lost track of behind them is no option until they look round', () => {
    const world = scene(6, 0, 0, 8, 6)
    const [carrier, mate] = world.teams[RED].outfielders
    expect(passOptions(world, carrier).some((o) => o.receiver === mate)).toBe(true)
    // Five seconds later they've drifted round behind, unseen and silent: forgotten as an option.
    place(mate, -7, 6)
    world.time += 5
    expect(passOptions(world, carrier).some((o) => o.receiver === mate)).toBe(false)
    lookAround(world)
    expect(passOptions(world, carrier).some((o) => o.receiver === mate)).toBe(true)
  })
})

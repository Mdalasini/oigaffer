import { describe, expect, test } from 'bun:test'
import { Dribbler, Facing, Offside, Position, Velocity } from './components'
import { BALL_RADIUS, GOAL_X } from './constants'
import { createMatch, endShot, handOver, requestShot, scoreFromPlay, setVec, stepMatch, winBall, type Match } from './match'
import { inOffsidePosition } from './offside'
import { passOptions, strikePass, type PassOption } from './playmaking'
import { shotUnderway } from './testUtils'
import { FOOT_OFFSET } from './touch'

const RED = 0
const BLUE = 1

function place(eid: number, x: number, y: number, facing = 0) {
  setVec(Position, eid, x, y, 0)
  setVec(Velocity, eid, 0, 0, 0)
  Facing.angle[eid] = facing
}

/**
 * Red on the ball at (x, 0) attacking +x, Red's teammate at (mx, my), Blue's
 * two outfielders out wide at (d1, -10) and (d2, 10), out of the way of a
 * pass, and Blue's keeper on their line.
 */
function scene(x: number, mx: number, my: number, d1: number, d2: number): Match {
  const world = createMatch({ outfielders: 2, seed: 1 })
  const [carrier, mate] = world.teams[RED].outfielders
  const [blueA, blueB] = world.teams[BLUE].outfielders
  handOver(world, carrier)
  place(carrier, x, 0)
  setVec(Position, world.ball, x + FOOT_OFFSET, 0, BALL_RADIUS)
  setVec(Velocity, world.ball, 0, 0, 0)
  place(mate, mx, my, Math.PI)
  place(blueA, d1, -10, Math.PI)
  place(blueB, d2, 10, Math.PI)
  place(world.teams[BLUE].keeper, GOAL_X - 0.5, 0, Math.PI)
  return world
}

/** A pass to feet from the carrier to their teammate, as if it had been chosen. */
function passTo(world: Match, mate: number): PassOption {
  const x = Position.x[mate]
  const y = Position.y[mate]
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  return { receiver: mate, kind: 'feet', x, y, speed: 6 + Math.hypot(x - bx, y - by) * 0.35, safety: 1, value: 1 }
}

function play(world: Match, seconds: number) {
  for (let i = 0; i < seconds * 120 && world.phase === 'play'; i++) stepMatch(world)
}

describe('offside position', () => {
  test('beyond the second-last defender and the ball, in the opponents’ half', () => {
    const world = scene(0, 12, 3, 8, 10)
    expect(inOffsidePosition(world, world.teams[RED].outfielders[1])).toBe(true)
  })

  test('level with the second-last defender, behind the ball, or in their own half, is onside', () => {
    const world = scene(0, 10, 3, 8, 10)
    const mate = world.teams[RED].outfielders[1]
    expect(inOffsidePosition(world, mate)).toBe(false)
    place(mate, -3, 3)
    place(world.teams[BLUE].outfielders[0], -8, -6)
    expect(inOffsidePosition(world, mate)).toBe(false)
    // Ahead of everyone but behind the ball.
    place(world.carrier, 15, 0)
    setVec(Position, world.ball, 15.3, 0, BALL_RADIUS)
    place(mate, 13, 3)
    expect(inOffsidePosition(world, mate)).toBe(false)
  })
})

describe('the offence', () => {
  test('receiving a pass from an offside position stops play for an indirect free kick where they were', () => {
    const world = scene(-5, 12, 3, 8, 10)
    const mate = world.teams[RED].outfielders[1]
    let offsides = 0
    world.onEvent = (e) => e.kind === 'offside' && offsides++
    strikePass(world, world.carrier, passTo(world, mate))
    expect(Offside.flagged[mate]).toBe(1)
    play(world, 4)
    expect(offsides).toBe(1)
    expect(world.stats[RED].offsides).toBe(1)
    expect(world.phase).toBe('stopped')
    expect(world.restart?.kind).toBe('free-kick')
    expect(world.restart?.team).toBe(BLUE)
    expect(Math.abs((world.restart?.x ?? 0) - Position.x[mate])).toBeLessThan(1)
  })

  test('a player onside when it is played can run beyond the line to take it', () => {
    const world = scene(-5, 7, 3, 8, 10)
    const mate = world.teams[RED].outfielders[1]
    strikePass(world, world.carrier, { ...passTo(world, mate), kind: 'through', x: 14, y: 2, speed: 13 })
    expect(Offside.flagged[mate]).toBe(0)
    play(world, 3)
    expect(world.stats[RED].offsides).toBe(0)
  })

  test('there is no offside from a throw-in', () => {
    const world = scene(-5, 12, 3, 8, 10)
    world.restart = { kind: 'throw-in', team: RED, x: 5, y: 15 }
    world.phase = 'stopped'
    world.phaseTime = 10
    stepMatch(world)
    expect(world.phase as string).toBe('play')
    expect(world.offsideExempt).toBe(true)
    // The taker's first touch judges nobody.
    const mate = world.teams[RED].outfielders.find((eid) => eid !== world.carrier)!
    place(mate, 20, 3)
    for (let i = 0; i < 120 && world.offsideExempt; i++) stepMatch(world)
    expect(world.offsideExempt).toBe(false)
    expect(Offside.flagged[mate]).toBe(0)
  })

  test('the other team playing the ball ends it', () => {
    const world = scene(-5, 12, 3, 8, 10)
    const mate = world.teams[RED].outfielders[1]
    strikePass(world, world.carrier, passTo(world, mate))
    expect(Offside.flagged[mate]).toBe(1)
    // Blue cuts it out.
    play(world, 0.2)
    winBall(world, world.teams[BLUE].outfielders.find((eid) => eid !== world.presser)!, 'intercepted')
    expect(world.possession).toBe(BLUE)
    expect(Offside.flagged[mate]).toBe(0)
  })
})

describe('involvement, however it happens', () => {
  test('a flagged player handed the ball can’t shoot or pass their way out of it', () => {
    const world = scene(-5, 12, 3, 8, 10)
    const mate = world.teams[RED].outfielders[1]
    Offside.flagged[mate] = 1
    handOver(world, mate)
    setVec(Position, world.ball, Position.x[mate] + FOOT_OFFSET, Position.y[mate], BALL_RADIUS)
    Facing.angle[mate] = 0
    requestShot(world)
    stepMatch(world)
    expect(world.stats[RED].shots).toBe(0)
    expect(world.stats[RED].offsides).toBe(1)
    expect(world.restart?.kind).toBe('free-kick')
  })

  test('a flagged player the ball hits is involved: offside, not a deflection', () => {
    const world = scene(-5, 12, 0, 8, 10)
    const mate = world.teams[RED].outfielders[1]
    Offside.flagged[mate] = 1
    world.lastTouchedBy = world.carrier
    // The ball about to run into them.
    setVec(Position, world.ball, 11, 0, BALL_RADIUS)
    setVec(Velocity, world.ball, 12, 0, 0)
    // Not a touch they chose to play: the ball just hits them.
    Dribbler.cooldown[mate] = 1
    let deflected = false
    for (let i = 0; i < 20 && world.phase === 'play'; i++) {
      stepMatch(world)
      deflected ||= world.lastTouchedBy === mate
    }
    expect(world.stats[RED].offsides).toBe(1)
    expect(deflected).toBe(false)
  })

  test('winning the ball judges offside for the team that won it', () => {
    const world = scene(-5, 12, 3, 8, 10)
    const [blueA, blueB] = world.teams[BLUE].outfielders
    // Blue's other outfielder is beyond Red's last outfielder, deep in Red's half.
    place(world.teams[RED].outfielders[1], -2, 5)
    place(blueB, -15, 6, Math.PI)
    place(world.teams[RED].keeper, -GOAL_X + 0.5, 0)
    winBall(world, blueA, 'intercepted')
    expect(Offside.flagged[blueB]).toBe(1)
  })
})

describe('the free kick for offside', () => {
  test('is indirect: straight in without anyone else touching it is no goal', () => {
    const world = scene(-5, 12, 3, 8, 10)
    world.restart = { kind: 'free-kick', team: RED, x: GOAL_X - 8, y: 0 }
    world.phase = 'stopped'
    world.phaseTime = 10
    stepMatch(world)
    expect(world.indirectTaker).toBe(world.carrier)
    // Rolled in: a goal kick.
    scoreFromPlay(world, RED)
    expect(world.stats[RED].goals).toBe(0)
    expect(world.restart?.kind).toBe('goal-kick')
  })

  test('is indirect: a shot straight in from it counts as missed', () => {
    const world = scene(-5, 12, 3, 8, 10)
    world.indirectTaker = world.carrier
    shotUnderway(world)
    endShot(world, 'goal', { y: 0, z: 1 })
    expect(world.stats[RED].goals).toBe(0)
    expect(world.stats[RED].missed).toBe(1)
  })

  test('once another player has touched it, it’s a normal ball', () => {
    const world = scene(-5, 12, 3, 8, 10)
    world.restart = { kind: 'free-kick', team: RED, x: 0, y: 0 }
    world.phase = 'stopped'
    world.phaseTime = 10
    stepMatch(world)
    const taker = world.carrier
    // The taker can't play it again this step; their teammate just has.
    Dribbler.cooldown[taker] = 1
    world.lastTouchedBy = world.teams[RED].outfielders.find((eid) => eid !== taker)!
    stepMatch(world)
    expect(world.indirectTaker).toBe(-1)
  })
})

describe('players who know the law', () => {
  test('the carrier doesn’t pass to a teammate standing offside', () => {
    const world = scene(-5, 12, 3, 8, 10)
    const mate = world.teams[RED].outfielders[1]
    expect(passOptions(world, world.carrier).some((o) => o.receiver === mate)).toBe(false)
  })
})

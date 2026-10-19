import { describe, expect, test } from 'bun:test'
import { Facing, OffBall, Position, Velocity } from './components'
import { BALL_RADIUS } from './constants'
import { SMALL_SIDED_PITCH } from './pitch'
import { createMatch, handOver, keeperClaims, setVec, stepMatch, type Match } from './match'
import { along, onsideLimit } from './shape'
import { bestReceiver, passToOutfielder } from './systems/keeper'
import { ownGoalX } from './teams'
import { FOOT_OFFSET } from './touch'

// These scenes play on the default five-a-side pitch.
const CIRCLE_RADIUS = SMALL_SIDED_PITCH.circleRadius
const GOAL_X = SMALL_SIDED_PITCH.halfLength

const RED = 0
const BLUE = 1

const allOutfielders = (world: Match) => [...world.teams[RED].outfielders, ...world.teams[BLUE].outfielders]

function place(eid: number, x: number, y: number, facing = 0, vx = 0, vy = 0) {
  setVec(Position, eid, x, y, 0)
  setVec(Velocity, eid, vx, vy, 0)
  Facing.angle[eid] = facing
}

describe('squads', () => {
  test('two outfielders a side, and everyone starts in their own half with the opponents outside the circle', () => {
    const world = createMatch({ outfielders: 2, seed: 2 })
    expect(world.teams[RED].outfielders).toHaveLength(2)
    expect(world.teams[BLUE].outfielders).toHaveLength(2)
    for (const eid of allOutfielders(world)) {
      if (eid === world.carrier) continue
      const team = world.teams[RED].outfielders.includes(eid) ? RED : BLUE
      expect(along(team, Position.x[eid])).toBeLessThanOrEqual(0)
      if (team === BLUE) expect(Math.hypot(Position.x[eid], Position.y[eid])).toBeGreaterThanOrEqual(CIRCLE_RADIUS)
    }
  })
})

describe('sharing the work', () => {
  test('once the presser is beaten, the covering defender steps in', () => {
    const world = createMatch({ outfielders: 2, seed: 3 })
    const red = world.carrier
    const redMate = world.teams[RED].outfielders.find((eid) => eid !== red)!
    const [blueA, blueB] = world.teams[BLUE].outfielders
    // Red is through, running at goal; one Blue defender is left behind, the other is ahead.
    place(red, 5, 0, 0, 6, 0)
    setVec(Position, world.ball, 5 + FOOT_OFFSET, 0, BALL_RADIUS)
    setVec(Velocity, world.ball, 6, 0, 0)
    place(redMate, -10, 10)
    const behind = world.presser
    const ahead = behind === blueA ? blueB : blueA
    place(behind, 2, 1, Math.PI)
    place(ahead, 14, -1, Math.PI)
    for (let i = 0; i < 30; i++) stepMatch(world)
    expect(world.presser).toBe(ahead)
  })

  test('a loose ball that runs to a teammate stays with the team', () => {
    const world = createMatch({ outfielders: 2, seed: 4 })
    const [red, redMate] = world.teams[RED].outfielders
    const [blueA, blueB] = world.teams[BLUE].outfielders
    place(red, -10, 0)
    place(redMate, 5, 8, -Math.PI / 2)
    place(blueA, -10, -10)
    place(blueB, -12, -12)
    // Knocked away from Red, rolling towards their teammate.
    setVec(Position, world.ball, 5, 3, BALL_RADIUS)
    setVec(Velocity, world.ball, 0, 2, 0)
    let turnovers = 0
    world.onEvent = (e) => e.kind === 'intercepted' && turnovers++
    for (let i = 0; i < 120 * 2; i++) stepMatch(world)
    expect(world.possession).toBe(RED)
    expect(world.carrier).toBe(redMate)
    expect(turnovers).toBe(0)
  })

  test('the keeper picks out whichever teammate is free, not the one being marked', () => {
    const world = createMatch({ outfielders: 2, seed: 5 })
    const keeper = world.teams[BLUE].keeper
    const [blueA, blueB] = world.teams[BLUE].outfielders
    const [redA, redB] = world.teams[RED].outfielders
    place(keeper, GOAL_X - 1, 0, Math.PI)
    place(blueA, GOAL_X - 12, -7, Math.PI)
    place(redA, GOAL_X - 10.5, -6.6, 0)
    place(blueB, GOAL_X - 12, 7, Math.PI)
    place(redB, -15, 10, 0)
    const { receiver, safety } = bestReceiver(world, keeper, GOAL_X - 1, 0)
    expect(receiver).toBe(blueB)
    expect(safety).toBeGreaterThan(0.85)
  })
})

describe('review fixes', () => {
  test('a ball the keeper rolls out stays with the teammate it was meant for', () => {
    const world = createMatch({ outfielders: 2, seed: 6 })
    const keeper = world.teams[BLUE].keeper
    const [near, far] = world.teams[BLUE].outfielders
    const [redA, redB] = world.teams[RED].outfielders
    place(keeper, GOAL_X - 1, 0, Math.PI)
    place(near, GOAL_X - 5, 4, Math.PI)
    place(far, GOAL_X - 14, -2, 0)
    place(redA, -15, 10)
    place(redB, -15, -10)
    keeperClaims(world, keeper)
    passToOutfielder(world, keeper, far, GOAL_X - 1, 0)
    for (let i = 0; i < 120; i++) {
      stepMatch(world)
      if (world.carrier !== far) break
    }
    expect(world.carrier).toBe(far)
  })

  test('kept clear of the carrier, the attacker without the ball still aims to stay onside', () => {
    const world = createMatch({ outfielders: 2, seed: 7 })
    const [carrier, mate] = world.teams[RED].outfielders
    const [blueA, blueB] = world.teams[BLUE].outfielders
    handOver(world, carrier)
    place(carrier, 8, 4.5)
    setVec(Position, world.ball, 8.35, 4.5, BALL_RADIUS)
    place(mate, 9, 6)
    place(blueA, 12, 0, Math.PI)
    place(blueB, 15, -3, Math.PI)
    for (let i = 0; i < 60; i++) {
      stepMatch(world)
      if (world.possession !== RED || world.phase !== 'play') break
      // The line moves between their decisions, so allow for the metre of margin they aim for.
      expect(along(RED, OffBall.targetX[mate])).toBeLessThanOrEqual(onsideLimit(world, RED) + 1e-4)
    }
  })

  test('a player leaving the ball holds where they are rather than resuming an old plan', () => {
    const world = createMatch({ outfielders: 2, seed: 8 })
    const carrier = world.carrier
    const mate = world.teams[RED].outfielders.find((eid) => eid !== carrier)!
    place(carrier, 10, 5)
    handOver(world, mate)
    expect(OffBall.targetX[carrier]).toBeCloseTo(10, 4)
    expect(OffBall.targetY[carrier]).toBeCloseTo(5, 4)
  })
})

describe('moving like footballers', () => {
  // Ten minutes of play in each of three matches, sampled ten times a second, for the outfielders without a job on
  // the ball. One match alone swings by several points either way with how many times the ball changes hands.
  const speeds = { walk: 0, jog: 0, run: 0, sprint: 0 }
  let samples = 0
  let bunched = 0
  let pairs = 0
  let onside = 0
  let attackerSamples = 0
  let goalSide = 0
  let coverSamples = 0
  for (const seed of [9, 10, 11]) {
    const world = createMatch({ outfielders: 2, seed })
    for (let tick = 0; world.time < 600; tick++) {
      stepMatch(world)
      if (tick % 12 || world.phase !== 'play') continue
      for (const team of [RED, BLUE]) {
        const [a, b] = world.teams[team].outfielders
        pairs++
        if (Math.hypot(Position.x[a] - Position.x[b], Position.y[a] - Position.y[b]) < 3) bunched++
      }
      for (const eid of allOutfielders(world)) {
        if (eid === world.carrier || eid === world.presser) continue
        const speed = Math.hypot(Velocity.x[eid], Velocity.y[eid])
        samples++
        if (speed < 2) speeds.walk++
        else if (speed < 4.5) speeds.jog++
        else if (speed < 6.5) speeds.run++
        else speeds.sprint++
        const team = world.teams[RED].outfielders.includes(eid) ? RED : BLUE
        if (team === world.possession) {
          attackerSamples++
          if (along(team, Position.x[eid]) <= onsideLimit(world, team) + 1) onside++
        } else {
          coverSamples++
          const goalX = ownGoalX(world.pitch, team)
          if (Math.hypot(goalX - Position.x[eid], Position.y[eid]) <= Math.hypot(goalX - Position.x[world.ball], Position.y[world.ball]) + 1) goalSide++
        }
      }
    }
  }

  test('off the ball they mostly walk and jog, and sprint only now and then', () => {
    // Measured at 77% over twelve matches on the five-a-side pitch, which is roomy for two a side (73–80% each).
    expect((speeds.walk + speeds.jog) / samples).toBeGreaterThan(0.73)
    expect(speeds.sprint / samples).toBeLessThan(0.08)
  })

  test('teammates keep apart rather than crowd each other', () => {
    // Measured at 7–11% across seeds: mostly two defenders around the ball as the press changes hands.
    expect(bunched / pairs).toBeLessThan(0.12)
  })

  test('the attacker without the ball holds the line rather than straying offside', () => {
    expect(onside / attackerSamples).toBeGreaterThan(0.9)
  })

  test('the covering defender stays goal-side of the ball', () => {
    // Not always: a defender who has just been beaten is behind the ball until they recover, and the ball
    // changes hands often in a game of two a side. Measured at 73% over twelve matches (66–76% each).
    expect(goalSide / coverSamples).toBeGreaterThan(0.7)
  })
})

describe('moving like footballers, five a side', () => {
  const world = createMatch({ outfielders: 4, seed: 9 })
  let samples = 0
  let easy = 0
  let pairs = 0
  let bunched = 0
  let coverSamples = 0
  let goalSide = 0
  for (let tick = 0; world.time < 300; tick++) {
    stepMatch(world)
    if (tick % 12 || world.phase !== 'play') continue
    for (const team of [RED, BLUE]) {
      const squad = world.teams[team].outfielders
      for (let i = 0; i < squad.length; i++) {
        for (let j = i + 1; j < squad.length; j++) {
          pairs++
          if (Math.hypot(Position.x[squad[i]] - Position.x[squad[j]], Position.y[squad[i]] - Position.y[squad[j]]) < 3) bunched++
        }
      }
    }
    for (const eid of allOutfielders(world)) {
      if (eid === world.carrier || eid === world.presser) continue
      samples++
      if (Math.hypot(Velocity.x[eid], Velocity.y[eid]) < 4.5) easy++
      const team = world.teams[RED].outfielders.includes(eid) ? RED : BLUE
      if (team === world.possession) continue
      coverSamples++
      const goalX = ownGoalX(world.pitch, team)
      if (Math.hypot(goalX - Position.x[eid], Position.y[eid]) <= Math.hypot(goalX - Position.x[world.ball], Position.y[world.ball]) + 1) goalSide++
    }
  }

  test('off the ball they mostly walk and jog', () => {
    // Measured at 78–81% across seeds.
    expect(easy / samples).toBeGreaterThan(0.75)
  })

  test('four teammates keep apart rather than crowd each other', () => {
    // Measured at about 5%: before jobs were shared out, every spare defender went to the same cover spot and it was 9%.
    expect(bunched / pairs).toBeLessThan(0.07)
  })

  test('defenders without the ball stay goal-side of it', () => {
    expect(goalSide / coverSamples).toBeGreaterThan(0.7)
  })
})

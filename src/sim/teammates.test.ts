import { describe, expect, test } from 'bun:test'
import { Facing, Position, Velocity } from './components'
import { BALL_RADIUS, CIRCLE_RADIUS, GOAL_X } from './constants'
import { createMatch, setVec, stepMatch, type Match } from './match'
import { along, onsideLimit } from './shape'
import { bestReceiver } from './systems/keeper'
import { ownGoalX } from './teams'
import { FOOT_OFFSET } from './touch'

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
    const world = createMatch({ seed: 2 })
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
    const world = createMatch({ seed: 3 })
    const [red, redMate] = world.teams[RED].outfielders
    const [blueA, blueB] = world.teams[BLUE].outfielders
    world.carrier = red
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
    const world = createMatch({ seed: 4 })
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
    const world = createMatch({ seed: 5 })
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

describe('moving like footballers', () => {
  // Ten minutes of play, sampled ten times a second, for the outfielders without a job on the ball.
  const world = createMatch({ seed: 9 })
  const speeds = { walk: 0, jog: 0, run: 0, sprint: 0 }
  let samples = 0
  let bunched = 0
  let pairs = 0
  let onside = 0
  let attackerSamples = 0
  let goalSide = 0
  let coverSamples = 0
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
        const goalX = ownGoalX(team)
        if (Math.hypot(goalX - Position.x[eid], Position.y[eid]) <= Math.hypot(goalX - Position.x[world.ball], Position.y[world.ball]) + 1) goalSide++
      }
    }
  }

  test('off the ball they mostly walk and jog, and sprint only now and then', () => {
    expect((speeds.walk + speeds.jog) / samples).toBeGreaterThan(0.8)
    expect(speeds.sprint / samples).toBeLessThan(0.08)
  })

  test('teammates keep apart rather than crowd each other', () => {
    expect(bunched / pairs).toBeLessThan(0.1)
  })

  test('the attacker without the ball holds the line rather than straying offside', () => {
    expect(onside / attackerSamples).toBeGreaterThan(0.9)
  })

  test('the covering defender stays goal-side of the ball', () => {
    // Not always: a defender who has just been beaten is behind the ball until they recover.
    expect(goalSide / coverSamples).toBeGreaterThan(0.75)
  })
})

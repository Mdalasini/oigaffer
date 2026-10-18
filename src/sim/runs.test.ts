import { describe, expect, test } from 'bun:test'
import { Call, CallKind, Facing, Position, Run, RunPhase, Velocity } from './components'
import { BALL_RADIUS, GOAL_X } from './constants'
import { createMatch, setVec, stepMatch, type GradeOverrides, type Match } from './match'
import { attackingIntent } from './attacking'
import { passOptions } from './playmaking'
import { along, onsideLimit } from './shape'
import { passSafety } from './space/control'
import { FOOT_OFFSET } from './touch'

const RED = 0
const BLUE = 1

function place(eid: number, x: number, y: number, facing = 0) {
  setVec(Position, eid, x, y, 0)
  setVec(Velocity, eid, 0, 0, 0)
  Facing.angle[eid] = facing
}

/** Red's carrier at (x, y) facing goal with the ball, their teammate at (mx, my), and Blue's two outfielders where given. */
function scene(seed: number, x: number, y: number, mx: number, my: number, blue: [number, number][], grades: GradeOverrides = {}): Match {
  const world = createMatch({ seed, grades })
  const [carrier, mate] = world.teams[RED].outfielders
  world.carrier = carrier
  place(carrier, x, y)
  setVec(Position, world.ball, x + FOOT_OFFSET, y, BALL_RADIUS)
  setVec(Velocity, world.ball, 0, 0, 0)
  place(mate, mx, my)
  world.teams[BLUE].outfielders.forEach((eid, i) => place(eid, blue[i][0], blue[i][1], Math.PI))
  place(world.teams[BLUE].keeper, GOAL_X - 0.5, 0, Math.PI)
  return world
}

/** Steps the match, watching `eid`; returns whether `seen` became true within `seconds`. */
function within(world: Match, seconds: number, seen: () => boolean) {
  for (let i = 0; i < seconds * 120 && world.phase === 'play' && world.possession === RED; i++) {
    stepMatch(world)
    if (seen()) return true
  }
  return false
}

describe('running in behind', () => {
  test('with the carrier free and facing goal, the forward checks away and then runs for the space behind', () => {
    const grades = { red: { outfielder: { offTheBall: 20 } } }
    // Red has time in midfield; Blue's line is high, with space behind it.
    const world = scene(1, -8, 0, 4, 6, [[6, -4], [6, 8]], grades)
    const mate = world.teams[RED].outfielders[1]
    let prepared = false
    const ran = within(world, 6, () => {
      prepared ||= Run.phase[mate] === RunPhase.Prepare
      return Run.phase[mate] === RunPhase.Go
    })
    expect(prepared).toBe(true)
    expect(ran).toBe(true)
    // The run is for the space beyond the line, and they call for it there.
    expect(along(RED, Run.targetX[mate])).toBeGreaterThan(onsideLimit(world, RED))
    expect(Call.kind[mate]).toBe(CallKind.Space)
  })

  test('better movers make more runs', () => {
    const runs = (offTheBall: number) => {
      let count = 0
      for (const seed of [1, 2, 3]) {
        const world = createMatch({ seed, grades: { red: { outfielder: { offTheBall } }, blue: { outfielder: { offTheBall } } } })
        const before = new Map<number, number>()
        for (let i = 0; i < 120 * 120; i++) {
          stepMatch(world)
          for (const team of world.teams) {
            for (const eid of team.outfielders) {
              if (Run.phase[eid] === RunPhase.Prepare && before.get(eid) !== RunPhase.Prepare) count++
              before.set(eid, Run.phase[eid])
            }
          }
        }
      }
      return count
    }
    expect(runs(20)).toBeGreaterThan(runs(1) * 1.3)
  })

  test('the carrier hears a run they can’t see, and can put it into the space being called for', () => {
    const grades = { red: { outfielder: { vision: 1 } } }
    const world = scene(2, 0, 0, -2, 12, [[10, -6], [12, 6]], grades)
    const [carrier, mate] = world.teams[RED].outfielders
    // Facing away from the teammate, who is calling for it in behind.
    Facing.angle[carrier] = -0.8
    Call.kind[mate] = CallKind.Space
    Call.x[mate] = 16
    Call.y[mate] = 8
    let heard = 0
    let intoCall = 0
    for (let i = 0; i < 50; i++) {
      const options = passOptions(world, carrier)
      if (options.some((o) => o.receiver === mate)) heard++
      if (options.some((o) => o.kind === 'through' && Math.hypot(o.x - 16, o.y - 8) < 6)) intoCall++
    }
    expect(heard).toBe(50)
    expect(intoCall).toBeGreaterThan(0)
  })
})

describe('showing for it', () => {
  test('with the carrier closed down, a teammate in a blocked lane picks a spot a pass would reach, and calls for it', () => {
    // Red is hemmed in near the touchline, one Blue defender on them and the other in the lane to Red's teammate.
    const world = scene(3, -5, -12, -5, -2, [[-3.8, -12], [-5, -6]])
    const [carrier, mate] = world.teams[RED].outfielders
    const bx = Position.x[world.ball]
    const by = Position.y[world.ball]
    expect(passSafety(world, RED, bx, by, Position.x[mate], Position.y[mate], 10)).toBeLessThan(0.3)
    const spot = attackingIntent(world, mate)
    expect(Call.kind[mate]).toBe(CallKind.Feet)
    expect(passSafety(world, RED, bx, by, spot.x, spot.y, 10)).toBeGreaterThan(0.6)
    expect(Math.hypot(spot.x - Position.x[carrier], spot.y - Position.y[carrier])).toBeGreaterThan(6)
  })
})

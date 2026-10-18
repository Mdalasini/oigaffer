import { describe, expect, test } from 'bun:test'
import { Call, CallKind, Facing, OffBall, Position, Run, RunPhase, Velocity } from './components'
import { BALL_RADIUS, GOAL_X } from './constants'
import { createMatch, handOver, setVec, stepMatch, type GradeOverrides, type Match } from './match'
import { attackingIntent, restDefender } from './attacking'
import { passOptions } from './playmaking'
import { along, homePosition, onsideLimit } from './shape'
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
  const world = createMatch({ outfielders: 2, seed, grades })
  const [carrier, mate] = world.teams[RED].outfielders
  handOver(world, carrier)
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
        for (let i = 0; i < 5 * 60 * 120; i++) {
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
    // Five a side, five minutes a seed: measured at 2.5–2.8 times as many.
    expect(runs(20)).toBeGreaterThan(runs(1) * 1.5)
  }, 20_000)

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

describe('run bookkeeping', () => {
  test('a restart clears runs and calls for everyone, even players whose role stays the same', () => {
    const world = scene(4, 0, 0, 6, 6, [[10, -4], [10, 6]])
    const mate = world.teams[RED].outfielders[1]
    Run.phase[mate] = RunPhase.Go
    Run.timer[mate] = 1
    Call.kind[mate] = CallKind.Space
    world.restart = { kind: 'throw-in', team: RED, x: 0, y: 16 }
    world.phase = 'stopped'
    world.phaseTime = 10
    stepMatch(world)
    expect(Run.phase[mate]).toBe(RunPhase.None)
    expect(Call.kind[mate]).toBe(CallKind.None)
  })

  test('a check away is a real step towards the ball, even from standing', () => {
    const world = scene(-8, 0, 0, 4, 6, [[6, -4], [6, 8]], { red: { outfielder: { offTheBall: 1 } } })
    const mate = world.teams[RED].outfielders[1]
    // Settled where they are, then the run starts.
    OffBall.targetX[mate] = Position.x[mate]
    OffBall.targetY[mate] = Position.y[mate]
    OffBall.radius[mate] = 1.5
    OffBall.settled[mate] = 1
    Run.phase[mate] = RunPhase.Prepare
    Run.timer[mate] = 0.6
    Run.targetX[mate] = 14
    Run.targetY[mate] = 6
    OffBall.decideIn[mate] = 0
    const startX = Position.x[mate]
    const startY = Position.y[mate]
    for (let i = 0; i < 60; i++) stepMatch(world)
    expect(Math.hypot(Position.x[mate] - startX, Position.y[mate] - startY)).toBeGreaterThan(0.5)
  })

  test('a runner’s target goes right up to the line, and never past it, whatever the target was before', () => {
    const world = scene(-8, 0, 0, 4, 6, [[6, -4], [6, 8]])
    const mate = world.teams[RED].outfielders[1]
    const limit = onsideLimit(world, RED)
    // Holding a yard onside, settled.
    OffBall.targetX[mate] = limit - 1
    OffBall.targetY[mate] = 6
    OffBall.radius[mate] = 1.5
    OffBall.settled[mate] = 1
    Run.phase[mate] = RunPhase.Go
    Run.timer[mate] = 1.5
    Run.targetX[mate] = limit + 6
    Run.targetY[mate] = 6
    OffBall.decideIn[mate] = 0
    stepMatch(world)
    expect(along(RED, OffBall.targetX[mate])).toBeGreaterThan(onsideLimit(world, RED) - 0.5)
    expect(along(RED, OffBall.targetX[mate])).toBeLessThanOrEqual(onsideLimit(world, RED) + 1e-4)
  })
})

describe('five a side: complementary support', () => {
  /** Red's four with the first on the ball at (x, y), closed down by Blue's presser, and the rest where given. */
  function closedDown(x: number, y: number, mates: [number, number][], blue: [number, number][]): Match {
    const world = createMatch({ seed: 3 })
    const reds = world.teams[RED].outfielders
    handOver(world, reds[0])
    place(reds[0], x, y)
    setVec(Position, world.ball, x + FOOT_OFFSET, y, BALL_RADIUS)
    setVec(Velocity, world.ball, 0, 0, 0)
    mates.forEach(([mx, my], i) => place(reds[i + 1], mx, my))
    world.teams[BLUE].outfielders.forEach((eid, i) => place(eid, blue[i][0], blue[i][1], Math.PI))
    place(world.teams[BLUE].keeper, GOAL_X - 0.5, 0, Math.PI)
    world.phase = 'play'
    world.possession = RED
    return world
  }

  test('with the carrier closed down, the two who show for it offer different angles, and the deepest stays back', () => {
    // The carrier is pressed in midfield with the right side blocked; both teammates are up on the left,
    // where the best spot is the same for both of them.
    const world = closedDown(-5, 0, [[-16, 0], [-6, 9], [-3, 11]], [[-3.8, 0], [0, -5], [-2, -9], [6, 2]])
    const [, deep, a, b] = world.teams[RED].outfielders
    expect(restDefender(world)).toBe(deep)
    const bx = Position.x[world.ball]
    const by = Position.y[world.ball]
    const first = attackingIntent(world, a)
    const second = attackingIntent(world, b)
    const rest = attackingIntent(world, deep)
    expect(OffBall.showing[a] && OffBall.showing[b]).toBeTruthy()
    expect(OffBall.showing[deep]).toBe(0)
    expect(along(RED, rest.x)).toBeLessThan(along(RED, bx))
    const angle = (spot: { x: number; y: number }) => Math.atan2(spot.y - by, spot.x - bx)
    const apart = Math.abs(Math.atan2(Math.sin(angle(first) - angle(second)), Math.cos(angle(first) - angle(second))))
    // Without allowing for each other, both pick the same spot.
    expect(apart).toBeGreaterThan(0.4)
  })

  test('the rest defence is whoever plays deepest, and changes when they have the ball', () => {
    const world = createMatch({ seed: 3 })
    const reds = world.teams[RED].outfielders
    handOver(world, reds[1])
    world.possession = RED
    const deepest = (exclude: number) =>
      reds.filter((eid) => eid !== exclude).reduce((a, b) => (along(RED, homePosition(world, a).x) <= along(RED, homePosition(world, b).x) ? a : b))
    expect(restDefender(world)).toBe(deepest(reds[1]))
    handOver(world, restDefender(world))
    expect(restDefender(world)).not.toBe(world.carrier)
    expect(restDefender(world)).toBe(deepest(world.carrier))
  })

  test('a player who becomes the rest defence mid-run gives the run up', () => {
    const world = closedDown(-10, 0, [[-8, -12], [0, 12], [8, 0]], [[-30, 15], [-28, -15], [20, 15], [22, -15]])
    const rest = restDefender(world)
    Run.phase[rest] = RunPhase.Go
    Run.timer[rest] = 1.5
    Run.targetX[rest] = 20
    Run.targetY[rest] = -10
    const intent = attackingIntent(world, rest)
    expect(Run.phase[rest]).toBe(RunPhase.None)
    expect(intent.x).toBeLessThan(Position.x[world.ball])
  })

  test('the rest defence holds behind the ball even when the deepest place left is ahead of it', () => {
    // The base player has it deep; the next deepest place in the diamond is a wide one, level with or ahead of the ball.
    const world = closedDown(-10, 0, [[-6, -15], [-6, 15], [8, 0]], [[-30, 15], [-28, -15], [20, 15], [22, -15]])
    const rest = restDefender(world)
    expect(along(RED, homePosition(world, rest).x)).toBeGreaterThan(along(RED, Position.x[world.ball]) - 1)
    const intent = attackingIntent(world, rest)
    expect(along(RED, intent.x)).toBeLessThan(along(RED, Position.x[world.ball]) - 3)
  })

  test('two or fewer outfielders a side spare nobody for rest defence', () => {
    expect(restDefender(createMatch({ outfielders: 2, seed: 1 }))).toBe(-1)
  })

  describe('over five minutes of play', () => {
    const world = createMatch({ seed: 11 })
    let settled = 0
    let restBehind = 0
    let tooManyRunning = 0
    let possession = world.possession
    let carrier = world.carrier
    let changed = 0
    for (let tick = 0; world.time < 300; tick++) {
      stepMatch(world)
      if (world.possession !== possession || world.carrier !== carrier) changed = world.time
      possession = world.possession
      carrier = world.carrier
      if (tick % 12 || world.phase !== 'play') continue
      const squad = world.teams[possession].outfielders
      if (squad.filter((eid) => Run.phase[eid] !== RunPhase.None).length > 1) tooManyRunning++
      // Right after the ball changes hands, or while it's travelling, the shape is still reforming.
      if (world.pass || world.time - changed < 3) continue
      settled++
      if (along(possession, Position.x[restDefender(world)]) <= along(possession, Position.x[world.ball]) + 1) restBehind++
    }

    test('in settled possession, the rest defence is behind the ball', () => {
      // Measured at 90%: the rest are moments the ball has been played back past them.
      expect(restBehind / settled).toBeGreaterThan(0.85)
    })

    test('one runs in behind at a time', () => {
      expect(tooManyRunning).toBe(0)
    })
  })
})

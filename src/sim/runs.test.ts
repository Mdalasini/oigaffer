import { describe, expect, test } from 'bun:test'
import { Call, CallKind, Facing, OffBall, Outfielder, Passer, Position, Run, RunPhase, Velocity } from './components'
import { BALL_RADIUS } from './constants'
import { FULL_PITCH, SMALL_SIDED_PITCH } from './pitch'
import { lookAround } from './perception'
import { createMatch, handOver, setVec, stepMatch, type GradeOverrides, type Match } from './match'
import { attackingIntent, restDefender } from './attacking'
import { passOptions, rateFeetPass } from './playmaking'
import { along, homePosition, onsideLimit } from './shape'
import { passSafety } from './space/control'
import { FOOT_OFFSET } from './touch'

// These scenes play on the default five-a-side pitch.
const GOAL_X = SMALL_SIDED_PITCH.halfLength

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
  lookAround(world)
  return world
}

/**
 * The carrier holds on rather than passing, so a test is of the runner alone:
 * with a marker only goal-side of them, a pass to their feet is on too.
 */
function holdOn(world: Match) {
  Passer.nextLook[world.teams[RED].outfielders[0]] = Infinity
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
    holdOn(world)
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

  test('a forward far from the ball who sets off on a run looks again on the quick cadence, not the far one', () => {
    const grades = { red: { outfielder: { offTheBall: 20 } } }
    // The carrier is deep, over 30 m from the forward on Blue's line.
    const world = scene(2, -20, 0, 12, 4, [[14, -4], [14, 8]], grades)
    holdOn(world)
    const mate = world.teams[RED].outfielders[1]
    let wait = -1
    within(world, 6, () => {
      if (Run.phase[mate] === RunPhase.Prepare && wait === -1) wait = OffBall.decideIn[mate]
      return wait !== -1
    })
    expect(wait).toBeGreaterThan(0)
    expect(wait).toBeLessThanOrEqual(0.45)
  })

  test('better movers make more runs', () => {
    const runs = (offTheBall: number) => {
      let count = 0
      for (const seed of [1, 2, 3]) {
        const world = createMatch({ outfielders: 4, seed, grades: { red: { outfielder: { offTheBall } }, blue: { outfielder: { offTheBall } } } })
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
    holdOn(world)
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
    holdOn(world)
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
    const world = createMatch({ outfielders: 4, seed: 3 })
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
    lookAround(world)
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

  test('having picked a spot to show in, they make for it for a second before weighing the spots up again', () => {
    const world = closedDown(-5, 0, [[-16, 0], [-6, 9], [-3, 11]], [[-3.8, 0], [0, -5], [-2, -9], [6, 2]])
    const a = world.teams[RED].outfielders[2]
    // The poorest reader of the game, whose judgement of each spot is the noisiest.
    Outfielder.offTheBall[a] = 1
    const first = attackingIntent(world, a)
    expect(OffBall.showing[a]).toBe(1)
    // Fresh judgement every look would pick somewhere else from time to time; committed, they don't.
    for (let i = 1; i <= 9; i++) {
      world.time += 0.1
      const again = attackingIntent(world, a)
      expect(again.x).toBeCloseTo(first.x, 4)
      expect(again.y).toBeCloseTo(first.y, 4)
    }
  })

  test('showing for it when a pass goes elsewhere, they keep going where they were, unless that crowds the passer', () => {
    const world = closedDown(-5, 0, [[-16, 0], [-6, 9], [-3, 11]], [[-3.8, 0], [0, -5], [-2, -9], [6, 2]])
    const [passer, deep, a] = world.teams[RED].outfielders
    const spot = attackingIntent(world, a)
    // The passer has gone off the other way since playing it.
    place(passer, -12, -6)
    world.pass = { from: passer, to: deep, kind: 'feet', lofted: false, x: -16, y: 0, time: world.time }
    world.time += 2
    const during = attackingIntent(world, a)
    expect(OffBall.showing[a]).toBe(1)
    expect(during.x).toBeCloseTo(spot.x, 4)
    expect(during.y).toBeCloseTo(spot.y, 4)
    // With the spot right by the passer, they'd only crowd him: they take up the shape instead.
    place(passer, spot.x + 2, spot.y)
    world.time += 2
    attackingIntent(world, a)
    expect(OffBall.showing[a]).toBe(0)
  })

  test('a pass that makes someone showing for it the rest defence sends them back, not on', () => {
    const world = closedDown(-5, 0, [[-16, 0], [-6, 9], [-3, 11]], [[-3.8, 0], [0, -5], [-2, -9], [6, 2]])
    const [base, wide, , pivot] = world.teams[RED].outfielders
    // The pivot has it, closed down, with the base player resting behind; the wide player shows for it.
    handOver(world, pivot)
    place(pivot, -5, 0)
    expect(restDefender(world)).toBe(base)
    const spot = attackingIntent(world, wide)
    expect(OffBall.showing[wide]).toBe(1)
    // The pivot, having moved off the other way, plays it back to the base player, who as its receiver is now the
    // carrier: the wide player is deepest.
    place(pivot, -12, -6)
    world.pass = { from: pivot, to: base, kind: 'feet', lofted: false, x: -16, y: 0, time: world.time }
    handOver(world, base)
    expect(restDefender(world)).toBe(wide)
    world.time += 2
    const during = attackingIntent(world, wide)
    expect(OffBall.showing[wide]).toBe(0)
    expect(along(RED, during.x)).toBeLessThan(along(RED, spot.x))
  })

  test('the rest defence is whoever plays deepest, and changes when they have the ball', () => {
    const world = createMatch({ outfielders: 4, seed: 3 })
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
    // The base player has it at halfway; the next deepest place in the diamond is a wide one, level with or ahead of the ball.
    const world = closedDown(0, 0, [[4, -15], [4, 15], [16, 0]], [[-20, 15], [-18, -15], [20, 15], [22, -15]])
    const rest = restDefender(world)
    expect(along(RED, homePosition(world, rest).x)).toBeGreaterThan(along(RED, Position.x[world.ball]) - 1)
    const intent = attackingIntent(world, rest)
    expect(along(RED, intent.x)).toBeLessThan(along(RED, Position.x[world.ball]) - 3)
  })

  test('building it up deep in their own half, the rest defence comes up level with the ball to offer the pass across', () => {
    // The base player has it a few metres from their own goal line, under no pressure; the next deepest place is ahead of the ball.
    const world = closedDown(-24, 0, [[-20, -14], [-20, 14], [-5, 0]], [[-5, 10], [-5, -10], [10, 5], [12, -5]])
    const rest = restDefender(world)
    const ball = along(RED, Position.x[world.ball])
    expect(along(RED, homePosition(world, rest).x)).toBeGreaterThan(ball)
    const intent = attackingIntent(world, rest)
    expect(along(RED, intent.x)).toBeGreaterThan(ball - 1)
    expect(along(RED, intent.x)).toBeLessThanOrEqual(ball + 1e-4)
  })

  test('two or fewer outfielders a side spare nobody for rest defence', () => {
    expect(restDefender(createMatch({ outfielders: 2, seed: 1 }))).toBe(-1)
  })

  // Pooled over several matches: one match's share swings from 60% to 95% with the seed.
  describe('over five minutes of play, in each of six matches', () => {
    let settled = 0
    let restBehind = 0
    let tooManyRunning = 0
    for (const seed of [11, 1, 2, 3, 4, 5]) {
      const world = createMatch({ outfielders: 4, seed })
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
    }

    test('in settled possession, the rest defence is behind the ball', () => {
      // Measured at 77–83% over eight seeds: the rest are moments the ball has been played back past them.
      expect(restBehind / settled).toBeGreaterThan(0.75)
    })

    test('one runs in behind at a time', () => {
      expect(tooManyRunning).toBe(0)
    })
  })
})

describe('opening a lane', () => {
  test('a teammate ahead of the ball whose lane is cut out moves across off their place to where a pass would reach them', () => {
    // Red's base player has the ball in midfield with time, facing forward. A Blue defender stands in the lane to the
    // pivot's place up front; the others are well away.
    const world = createMatch({ outfielders: 4, seed: 5, grades: { red: { outfielder: { offTheBall: 20 } } } })
    const [carrier, wideA, wideB, pivot] = world.teams[RED].outfielders
    handOver(world, carrier)
    world.phase = 'play'
    world.possession = RED
    place(carrier, -14, 0)
    setVec(Position, world.ball, -14 + FOOT_OFFSET, 0, BALL_RADIUS)
    setVec(Velocity, world.ball, 0, 0, 0)
    place(wideA, -10, -16)
    place(wideB, -10, 16)
    const [blocker, ...others] = world.teams[BLUE].outfielders
    place(others[0], -2, -18, Math.PI)
    place(others[1], 1, 19, Math.PI)
    place(others[2], 10, 15, Math.PI)
    place(world.teams[BLUE].keeper, GOAL_X - 0.5, 0, Math.PI)
    // Where the blocker goes depends on the pivot's place, which depends on Blue's line: they stand in front of it.
    place(blocker, -5, 0, Math.PI)
    place(pivot, 6, 0)
    const home = homePosition(world, pivot)
    place(pivot, home.x, home.y)
    const bx = Position.x[world.ball]
    const by = Position.y[world.ball]
    place(blocker, bx + (home.x - bx) * 0.5, by + (home.y - by) * 0.5, Math.PI)
    // No run in behind for now: this is about holding a place.
    Run.rest[pivot] = 5
    lookAround(world)
    const spot = attackingIntent(world, pivot)
    expect(OffBall.showing[pivot]).toBe(0)
    const safety = (x: number, y: number) => rateFeetPass(world, RED, pivot, x, y).safety
    expect(safety(home.x, home.y)).toBeLessThan(0.3)
    expect(safety(spot.x, spot.y)).toBeGreaterThan(0.6)
    // Across or forward of their place, not dropping towards the ball.
    expect(along(RED, spot.x)).toBeGreaterThan(along(RED, home.x) - 0.5)
  })

  /**
   * Red's carrier in midfield with everything mirrored about the middle, so the lanes either side of the pivot's
   * place are worth the same, and a Blue defender in the lane to that place. The carrier has just played it wide,
   * to be received where the ball is, so the next pass is from there too.
   */
  function mirrored(offTheBall: number) {
    const world = createMatch({ outfielders: 4, seed: 5, grades: { red: { outfielder: { offTheBall } } } })
    const [carrier, wideA, wideB, pivot] = world.teams[RED].outfielders
    handOver(world, carrier)
    world.phase = 'play'
    world.possession = RED
    place(carrier, -14, 0)
    setVec(Position, world.ball, -14 + FOOT_OFFSET, 0, BALL_RADIUS)
    setVec(Velocity, world.ball, 0, 0, 0)
    place(wideA, -10, -16)
    place(wideB, -10, 16)
    const [blocker, ...others] = world.teams[BLUE].outfielders
    place(others[0], -2, -16, Math.PI)
    place(others[1], -2, 16, Math.PI)
    place(others[2], 6, 0, Math.PI)
    place(world.teams[BLUE].keeper, GOAL_X - 0.5, 0, Math.PI)
    // Where the blocker goes depends on the pivot's place, which depends on Blue's line: they stand in front of it.
    place(blocker, -5, 0, Math.PI)
    place(pivot, 6, 0)
    const home = homePosition(world, pivot)
    place(pivot, home.x, home.y)
    const bx = Position.x[world.ball]
    const by = Position.y[world.ball]
    // A Blue defender in the lane to the pivot's place, so they look across for one.
    place(blocker, bx + (home.x - bx) * 0.5, by + (home.y - by) * 0.5, Math.PI)
    Run.rest[pivot] = 5
    lookAround(world)
    world.pass = { from: carrier, to: wideA, kind: 'feet', lofted: false, x: bx, y: by, time: world.time }
    return { world, pivot, home }
  }

  test('a lane they have found keeps them while a pass is played to someone else, as it does while the ball is held', () => {
    const { world, pivot, home } = mirrored(20)
    attackingIntent(world, pivot)
    const chosen = [OffBall.laneX[pivot], OffBall.laneY[pivot]]
    expect(Math.abs(chosen[1])).toBeGreaterThan(1)
    // Holding the mirror image of that lane instead, they stay in it: it's worth as much.
    OffBall.laneX[pivot] = chosen[0]
    OffBall.laneY[pivot] = -chosen[1]
    const spot = attackingIntent(world, pivot)
    expect(OffBall.laneY[pivot]).toBeCloseTo(-chosen[1], 6)
    expect(spot.y - home.y).toBeCloseTo(-chosen[1], 6)
    // Just as they would once the pass has arrived.
    world.pass = null
    attackingIntent(world, pivot)
    expect(OffBall.laneY[pivot]).toBeCloseTo(-chosen[1], 6)
  })

  test('a player who reads lanes less surely doesn’t swap between two as good on a fresh misread', () => {
    const { world, pivot } = mirrored(1)
    // Already in the lane across to one side.
    OffBall.laneX[pivot] = 0
    OffBall.laneY[pivot] = 6
    let lane = OffBall.laneY[pivot]
    let swaps = 0
    for (let look = 0; look < 40; look++) {
      attackingIntent(world, pivot)
      if (OffBall.laneY[pivot] !== lane) swaps++
      lane = OffBall.laneY[pivot]
    }
    expect(swaps).toBeLessThanOrEqual(6)
  })

  test('who looks for a lane goes by where they reckon their teammates are, not where those teammates have since gone unseen', () => {
    const world = createMatch({ outfielders: 10, seed: 5, grades: { red: { outfielder: { offTheBall: 20 } } } })
    const reds = world.teams[RED].outfielders
    const carrier = reds[4]
    const seeker = reds[9]
    const others = reds.filter((eid) => eid !== carrier && eid !== seeker)
    handOver(world, carrier)
    world.phase = 'play'
    world.possession = RED
    place(carrier, -20, 0)
    setVec(Position, world.ball, -20 + FOOT_OFFSET, 0, BALL_RADIUS)
    setVec(Velocity, world.ball, 0, 0, 0)
    // Everyone else well away from the ball: deep, or wide and far up.
    others.forEach((eid, i) => place(eid, i < 4 ? -40 : 15, i < 4 ? -25 + 16 * i : (i % 2 ? -30 : 30)))
    const blues = world.teams[BLUE].outfielders
    // Blue's line is two wide defenders at x = 5; the rest are out of play behind the ball.
    blues.forEach((eid, i) => place(eid, i < 3 ? 5 : -45, i < 3 ? (i % 2 ? -30 : 30) : -30 + 8 * i, Math.PI))
    place(world.teams[BLUE].keeper, FULL_PITCH.halfLength - 0.5, 0, Math.PI)
    place(seeker, 0, 0)
    const home = homePosition(world, seeker)
    place(seeker, home.x, home.y)
    Run.rest[seeker] = 5
    // One Blue defender in the lane to the seeker's place.
    const bx = Position.x[world.ball]
    const by = Position.y[world.ball]
    place(blues[0], bx + (home.x - bx) * 0.5, by + (home.y - by) * 0.5, Math.PI)
    lookAround(world)
    attackingIntent(world, seeker)
    const lane = [OffBall.laneX[seeker], OffBall.laneY[seeker]]
    expect(Math.hypot(lane[0], lane[1])).toBeGreaterThan(1)
    // Three teammates slip in nearer the ball, ahead of it, while the seeker isn't looking.
    place(others[4], bx + 6, by - 5)
    place(others[5], bx + 6, by + 5)
    place(others[6], bx + 8, by)
    attackingIntent(world, seeker)
    expect([OffBall.laneX[seeker], OffBall.laneY[seeker]]).toEqual(lane)
  })

  test('the rest defence and players behind the ball keep their places', () => {
    const world = createMatch({ outfielders: 4, seed: 5 })
    const [carrier, wideA, wideB, pivot] = world.teams[RED].outfielders
    handOver(world, wideA)
    world.phase = 'play'
    world.possession = RED
    place(wideA, 10, -10)
    setVec(Position, world.ball, 10 + FOOT_OFFSET, -10, BALL_RADIUS)
    setVec(Velocity, world.ball, 0, 0, 0)
    place(carrier, -10, 0)
    place(wideB, 0, 14)
    place(pivot, 18, 0)
    world.teams[BLUE].outfielders.forEach((eid, i) => place(eid, 22, -12 + 8 * i, Math.PI))
    place(world.teams[BLUE].keeper, GOAL_X - 0.5, 0, Math.PI)
    lookAround(world)
    const rest = restDefender(world)
    expect(rest).toBe(carrier)
    for (const eid of [carrier, wideB]) {
      const home = homePosition(world, eid)
      expect(along(RED, home.x)).toBeLessThan(along(RED, Position.x[world.ball]) + 2)
      attackingIntent(world, eid)
      expect(OffBall.laneX[eid]).toBe(0)
      expect(OffBall.laneY[eid]).toBe(0)
    }
  })

  test('eleven a side, with support opening lanes and the rest defence offering the pass across, under half the passes go backward', () => {
    // Pooled over three ten-minute matches: measured at 45–49% over seeds 21–29, against 54–56% with the rest
    // defence dropping off in build-up and nobody moving to open a lane.
    let passes = 0
    let backward = 0
    for (const seed of [24, 25, 26]) {
      const world = createMatch({ seed, outfielders: 10 })
      world.onCue = (c) => {
        if (c.kind !== 'passStruck' || !world.pass) return
        passes++
        if (along(world.possession, world.pass.x) - along(world.possession, Position.x[world.ball]) <= -2) backward++
      }
      while (world.time < 600) stepMatch(world)
    }
    expect(passes).toBeGreaterThan(300)
    expect(backward / passes).toBeLessThan(0.51)
  }, 30_000)
})

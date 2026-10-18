import { describe, expect, test } from 'bun:test'
import { Facing, Mark, OffBall, Outfielder, Position, Run, RunPhase, Velocity } from './components'
import { BALL_RADIUS } from './constants'
import { SMALL_SIDED_PITCH } from './pitch'
import { lookAround } from './perception'
import { createMatch, handOver, resetMatch, setVec, stepMatch, type GradeOverrides, type Match } from './match'
import { strikePass } from './playmaking'
import { along, baseLine, homePosition } from './shape'
import { attackingIntent } from './attacking'
import { canPlayForward, coverSpot, lineTarget, maybeSpringTrap, pressCue, trapping } from './systems/defending'
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

/** Red on the ball at (x, y) facing `facing`, Red's teammate at (mx, my), Blue's outfielders at the given spots. */
function scene(x: number, y: number, facing: number, mx: number, my: number, blue: [number, number][], grades: GradeOverrides = {}): Match {
  const world = createMatch({ outfielders: 2, seed: 1, grades })
  const [carrier, mate] = world.teams[RED].outfielders
  handOver(world, carrier)
  place(carrier, x, y, facing)
  setVec(Position, world.ball, x + Math.cos(facing) * FOOT_OFFSET, y + Math.sin(facing) * FOOT_OFFSET, BALL_RADIUS)
  setVec(Velocity, world.ball, 0, 0, 0)
  place(mate, mx, my, 0)
  world.teams[BLUE].outfielders.forEach((eid, i) => place(eid, blue[i][0], blue[i][1], Math.PI))
  place(world.teams[BLUE].keeper, GOAL_X - 0.5, 0, Math.PI)
  return world
}

describe('sharing out the marking', () => {
  test('the presser has the carrier, and the other defender the other attacker', () => {
    const world = scene(-5, 0, 0, 8, 8, [[-3, 0], [6, 6]])
    world.presser = world.teams[BLUE].outfielders[0]
    world.nextMarking = [0, 0]
    stepMatch(world)
    const [blueA, blueB] = world.teams[BLUE].outfielders
    expect(Mark.target[world.presser]).toBe(world.carrier)
    expect(Mark.target[blueA === world.presser ? blueB : blueA]).toBe(world.teams[RED].outfielders[1])
  })

  test('while the keeper holds it, each attacker is picked up by one defender', () => {
    const world = scene(-5, 0, 0, 8, 8, [[-8, -6], [4, 7]])
    const keeper = world.teams[RED].keeper
    world.phase = 'held'
    world.possession = RED
    world.nextMarking = [0, 0]
    place(keeper, -GOAL_X + 1, 0)
    stepMatch(world)
    const marks = world.teams[BLUE].outfielders.map((d) => Mark.target[d])
    expect(new Set(marks).size).toBe(2)
    for (const m of marks) expect(world.teams[RED].outfielders).toContain(m)
  })
})

describe('the line', () => {
  test('drops off when the carrier has time and is facing forward', () => {
    const world = scene(-5, 0, 0, 8, 8, [[10, 0], [12, 6]])
    expect(canPlayForward(world)).toBe(true)
    expect(lineTarget(world, BLUE)).toBeLessThan(baseLine(world, BLUE) - 2)
  })

  test('steps up when the carrier is facing their own goal', () => {
    // Red near halfway, facing back towards their own goal.
    const world = scene(-2, 0, Math.PI, 8, 8, [[-1, 0], [10, 6]])
    expect(pressCue(world)).toBe(true)
    expect(lineTarget(world, BLUE)).toBeGreaterThan(baseLine(world, BLUE) + 2)
  })

  test('the covering defender holds the line rather than following a runner past it', () => {
    const world = scene(-12, 0, 0, 6, 6, [[-10, 0], [8, 4]])
    const [blueA, blueB] = world.teams[BLUE].outfielders
    world.presser = blueA
    const mate = world.teams[RED].outfielders[1]
    world.lines[BLUE] = along(BLUE, 8)
    world.nextMarking = [0, 0]
    // The runner is already goal-side of the cover, as if they'd made a run without the ball.
    place(mate, 12, 4)
    OffBall.decideIn[blueB] = 0
    stepMatch(world)
    // The cover's target is no deeper than the line.
    expect(along(BLUE, OffBall.targetX[blueB])).toBeGreaterThanOrEqual(world.lines[BLUE] - 0.5)
  })
})

describe('runs behind a marker', () => {
  const delayFor = (positioning: number) => {
    const grades = { blue: { outfielder: { positioning } }, red: { outfielder: { offTheBall: 20 } } }
    // The runner is level with the marker but over their shoulder, onside.
    const world = scene(-8, 0, 0, 7.5, 6, [[-6, 0], [8, 3]], grades)
    const [, blueB] = world.teams[BLUE].outfielders
    const mate = world.teams[RED].outfielders[1]
    Outfielder.positioning[blueB] = positioning
    // The marker is turned towards the ball, away from the runner.
    Facing.angle[blueB] = Math.PI + 0.5
    Mark.target[blueB] = mate
    OffBall.decideIn[blueB] = 0
    Run.phase[mate] = RunPhase.Prepare
    Run.timer[mate] = 0
    Run.targetX[mate] = 15
    Run.targetY[mate] = 4
    world.phase = 'play'
    world.possession = RED
    attackingIntent(world, mate)
    expect(Run.phase[mate]).toBe(RunPhase.Go)
    return OffBall.decideIn[blueB]
  }

  test('a marker who can’t see the run is slow to pick it up, slower with worse positioning', () => {
    expect(delayFor(1)).toBeGreaterThan(delayFor(20) + 0.4)
    expect(delayFor(20)).toBeGreaterThan(0)
  })
})

describe('the offside trap', () => {
  test('with an attacker lurking on the line, a well-drilled line steps up together as the pass is shaped', () => {
    const sprung = (positioning: number) => {
      let count = 0
      for (let i = 0; i < 100; i++) {
        const world = scene(-10, 0, 0, 7.5, 4, [[-8, 0], [8, 4]], { blue: { outfielder: { positioning } } })
        world.presser = world.teams[BLUE].outfielders[0]
        world.trap = [0, 0]
        world.rng = (() => {
          const values = [i / 100]
          return () => values.shift() ?? 0.5
        })()
        maybeSpringTrap(world, 0.2)
        if (trapping(world, BLUE)) count++
      }
      return count / 100
    }
    expect(sprung(20)).toBeGreaterThan(sprung(1) + 0.3)
  })

  test('with nobody on the line, there’s no trap to spring', () => {
    const world = scene(-10, 0, 0, -15, 4, [[-8, 0], [8, 4]], { blue: { outfielder: { positioning: 20 } } })
    world.rng = () => 0
    maybeSpringTrap(world, 0.2)
    expect(trapping(world, BLUE)).toBe(false)
  })
})

describe('review fixes', () => {
  test('springing the trap moves a defender who was standing settled', () => {
    const world = scene(-10, 0, 0, 7.5, 4, [[-8, 0], [8, 4]], { blue: { outfielder: { positioning: 20 } } })
    const [blueA, blueB] = world.teams[BLUE].outfielders
    world.presser = blueA
    world.lines[BLUE] = along(BLUE, 8)
    OffBall.targetX[blueB] = 8
    OffBall.targetY[blueB] = 4
    OffBall.radius[blueB] = 2
    OffBall.settled[blueB] = 1
    OffBall.decideIn[blueB] = 1
    world.rng = () => 0
    maybeSpringTrap(world, 0.25)
    expect(trapping(world, BLUE)).toBe(true)
    // Half a second: from standing, a defender covers only about 0.1 m in the first quarter.
    for (let i = 0; i < 60; i++) stepMatch(world)
    // Stepping up for Blue is towards -x.
    expect(Position.x[blueB]).toBeLessThan(8 - 0.3)
  })

  test('a runner who reads a through ball late doesn’t go until they’ve read it', () => {
    // Blue are out of the pass's way.
    const world = scene(-12, 0, 0, 4, 6, [[-14, -6], [14, -8]])
    const [carrier, runner] = world.teams[RED].outfielders
    setVec(Velocity, runner, 0, 0, 0)
    Run.burstAt[runner] = world.time + 0.6
    strikePass(world, carrier, { receiver: runner, kind: 'through', x: 12, y: 6, speed: 14, safety: 1, value: 1 })
    const start = Position.x[runner]
    for (let i = 0; i < 60; i++) stepMatch(world)
    expect(world.pass?.to).toBe(runner)
    expect(Math.abs(Position.x[runner] - start)).toBeLessThan(0.3)
  })

  test('when the man being marked gets the ball, the marking is shared out again at once', () => {
    // The presser stays the same after the pass, so only the share-out can free the cover.
    const world = scene(-5, 0, 0, 2, 4, [[-1, 2], [12, 8]])
    const [carrier, mate] = world.teams[RED].outfielders
    const [blueA, blueB] = world.teams[BLUE].outfielders
    world.presser = blueA
    world.nextMarking = [0, 0]
    stepMatch(world)
    expect(Mark.target[blueB]).toBe(mate)
    // The teammate gets the ball at their feet, well before the next scheduled share-out.
    Facing.angle[mate] = 0
    setVec(Position, world.ball, Position.x[mate] + FOOT_OFFSET, Position.y[mate], BALL_RADIUS)
    setVec(Velocity, world.ball, 0, 0, 0)
    handOver(world, mate)
    stepMatch(world)
    expect(world.carrier).toBe(mate)
    expect(world.presser).toBe(blueA)
    // The cover now has the player who passed it, not the one the presser is going to.
    expect(Mark.target[blueB]).toBe(carrier)
  })

  test('keeping clear of the presser never drops the cover behind the line', () => {
    // Red's teammate is deep in Blue's half; Blue's line is at x = 8, the presser just in front of it.
    const world = scene(4, 0, 0, 10, 0.3, [[7, 0], [9, 3]])
    const [blueA, blueB] = world.teams[BLUE].outfielders
    world.presser = blueA
    world.lines[BLUE] = along(BLUE, 8)
    world.nextMarking = [0, 0]
    OffBall.decideIn[blueB] = 0
    stepMatch(world)
    expect(Mark.target[blueB]).toBe(world.teams[RED].outfielders[1])
    expect(along(BLUE, OffBall.targetX[blueB])).toBeGreaterThanOrEqual(world.lines[BLUE] - 0.5)
    // Still clear of the presser.
    expect(Math.hypot(OffBall.targetX[blueB] - Position.x[blueA], OffBall.targetY[blueB] - Position.y[blueA])).toBeGreaterThan(3)
  })

  test('a restart calls off a pass being wound up', () => {
    const world = scene(-5, 0, 0, 8, 8, [[-3, 0], [6, 6]])
    world.windup = { carrier: world.carrier, option: { receiver: world.teams[RED].outfielders[1], kind: 'feet', x: 8, y: 8, speed: 9, safety: 1, value: 1 }, at: world.time + 0.2 }
    resetMatch(world)
    expect(world.windup).toBeNull()
  })
})

describe('five-a-side: defending as a unit', () => {
  /** Red's four attacking from (x, y) with the ball, the rest where given; Blue's four where given. */
  function five(red: [number, number][], blue: [number, number][]): Match {
    const world = createMatch({ seed: 1 })
    const reds = world.teams[RED].outfielders
    handOver(world, reds[0])
    reds.forEach((eid, i) => place(eid, red[i][0], red[i][1], 0))
    setVec(Position, world.ball, red[0][0] + FOOT_OFFSET, red[0][1], BALL_RADIUS)
    setVec(Velocity, world.ball, 0, 0, 0)
    world.teams[BLUE].outfielders.forEach((eid, i) => place(eid, blue[i][0], blue[i][1], Math.PI))
    place(world.teams[BLUE].keeper, GOAL_X - 0.5, 0, Math.PI)
    world.presser = world.teams[BLUE].outfielders[0]
    world.nextMarking = [0, 0]
    // Everyone decides on this step.
    for (const eid of [...reds, ...world.teams[BLUE].outfielders]) OffBall.decideIn[eid] = 0
    lookAround(world)
    return world
  }

  test('one presses, one covers behind them, and the dangerous men are picked up once each', () => {
    // Red's carrier in midfield; two Red attackers high, one deep behind the ball.
    const world = five([[0, 0], [15, -8], [15, 8], [-12, 0]], [[2, 0], [10, 0], [14, -6], [14, 6]])
    stepMatch(world)
    const blue = world.teams[BLUE].outfielders
    const [, highLeft, highRight] = world.teams[RED].outfielders
    expect(Mark.target[world.presser]).toBe(world.carrier)
    const covers = blue.filter((d) => Mark.cover[d])
    expect(covers).toHaveLength(1)
    expect(covers[0]).not.toBe(world.presser)
    const marked = blue.filter((d) => d !== world.presser).map((d) => Mark.target[d])
    expect(marked).toContain(highLeft)
    expect(marked).toContain(highRight)
    expect(new Set(marked.filter((m) => m !== -1)).size).toBe(marked.filter((m) => m !== -1).length)
  })

  test('the cover goes behind the ball, between it and goal', () => {
    const world = five([[0, 0], [15, -8], [15, 8], [-12, 0]], [[2, 0], [10, 0], [14, -6], [14, 6]])
    stepMatch(world)
    const cover = world.teams[BLUE].outfielders.find((d) => Mark.cover[d])!
    const spot = coverSpot(world, BLUE)
    expect(Math.hypot(OffBall.targetX[cover] - spot.x, OffBall.targetY[cover] - spot.y)).toBeLessThan(4)
    expect(along(BLUE, OffBall.targetX[cover])).toBeLessThan(along(BLUE, Position.x[world.ball]))
  })

  test('a man well behind the ball is watched from the zone, not followed', () => {
    // A deep Red player is the only one left; whoever has him stays near their place in the block.
    const world = five([[0, 0], [-14, -12], [-14, 12], [-20, 0]], [[2, 0], [10, 0], [6, -6], [6, 6]])
    stepMatch(world)
    for (const d of world.teams[BLUE].outfielders) {
      if (d === world.presser || Mark.cover[d] || Mark.target[d] === -1) continue
      const home = homePosition(world, d)
      expect(Math.hypot(OffBall.targetX[d] - home.x, OffBall.targetY[d] - home.y)).toBeLessThan(4.5)
    }
  })
})

describe('eleven a side: defending near goal on a full-size pitch', () => {
  test('the line drops to about the six-yard box and the block stays compact in front of it', () => {
    const world = createMatch({ outfielders: 10, seed: 1 })
    const L = world.pitch.halfLength
    world.possession = RED
    // Red has the ball 8 m out from the goal Blue defends.
    setVec(Position, world.ball, L - 8, 5, BALL_RADIUS)
    world.lines[BLUE] = baseLine(world, BLUE)
    expect(world.lines[BLUE] + L).toBeCloseTo(9, 6)
    for (const eid of world.teams[BLUE].outfielders) {
      const fromGoalLine = along(BLUE, homePosition(world, eid).x) + L
      // Everyone within the block: the back line, and the rest no more than 18 m in front of it.
      expect(fromGoalLine).toBeGreaterThanOrEqual(9 - 1e-6)
      expect(fromGoalLine).toBeLessThanOrEqual(9 + 18 + 1e-6)
    }
  })
})

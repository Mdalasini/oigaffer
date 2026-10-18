import { describe, expect, test } from 'bun:test'
import { Facing, Mark, OffBall, Outfielder, Position, Run, RunPhase, Velocity } from './components'
import { BALL_RADIUS, GOAL_X } from './constants'
import { createMatch, setVec, stepMatch, type GradeOverrides, type Match } from './match'
import { along, baseLine } from './shape'
import { attackingIntent } from './attacking'
import { canPlayForward, lineTarget, maybeSpringTrap, pressCue, trapping } from './systems/defending'
import { FOOT_OFFSET } from './touch'

const RED = 0
const BLUE = 1

function place(eid: number, x: number, y: number, facing = 0) {
  setVec(Position, eid, x, y, 0)
  setVec(Velocity, eid, 0, 0, 0)
  Facing.angle[eid] = facing
}

/** Red on the ball at (x, y) facing `facing`, Red's teammate at (mx, my), Blue's outfielders at the given spots. */
function scene(x: number, y: number, facing: number, mx: number, my: number, blue: [number, number][], grades: GradeOverrides = {}): Match {
  const world = createMatch({ seed: 1, grades })
  const [carrier, mate] = world.teams[RED].outfielders
  world.carrier = carrier
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

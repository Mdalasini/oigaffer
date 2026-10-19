import { describe, expect, test } from 'bun:test'
import { Dribbler, Facing, Passer, Position, Velocity } from './components'
import { BALL_RADIUS, GOAL_HALF_WIDTH, GOAL_HEIGHT } from './constants'
import { SMALL_SIDED_PITCH } from './pitch'
import { landingChance, planShot, shotValue } from './finishing'
import { createMatch, handOver, requestShot, setVec, stepMatch, type GradeOverrides, type Match } from './match'
import { keepValue } from './playmaking'
import { createRng } from './rng'
import { sampleShotTarget } from './shooting'
import { shotChance } from './space/threat'
import { FOOT_OFFSET } from './touch'
import { laneClear } from './systems/carrier'
import { lookAround } from './perception'
import { attackedGoalX } from './teams'

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
 * Red's first outfielder `distance` metres out and `wide` metres across,
 * standing facing goal with the ball, everyone else far away unless a
 * Blue defender is put `pressure` metres off them or goal-side of them
 * (`covered`), and Blue's keeper given a second to set themselves.
 */
function chance(seed: number, distance: number, wide: number, grades: GradeOverrides = {}, pressure = Infinity, covered = false): Match {
  const world = createMatch({ outfielders: 4, seed, grades })
  const [shooter, ...mates] = world.teams[RED].outfielders
  const [defender, ...others] = world.teams[BLUE].outfielders
  const x = GOAL_X - distance
  const face = Math.atan2(-wide, GOAL_X - x)
  const hold = () => {
    // Not deciding anything until the keeper has set, and ready to strike it the moment they do: shot from here, not carried on.
    Passer.nextLook[shooter] = Infinity
    Dribbler.cooldown[shooter] = 0
    place(shooter, x, wide, face)
    setVec(Position, world.ball, x + Math.cos(face) * FOOT_OFFSET, wide + Math.sin(face) * FOOT_OFFSET, BALL_RADIUS)
    setVec(Velocity, world.ball, 0, 0, 0)
    mates.forEach((eid, i) => place(eid, -20, -10 + i * 5))
    others.forEach((eid, i) => place(eid, -25, -10 + i * 5))
    // A defender closing them down from the side, or out of the way.
    if (pressure !== Infinity) place(defender, x, wide + pressure, -Math.PI / 2)
    // Goal-side of them, off to one side, so they're not through on their own.
    else if (covered) place(defender, x + 4, wide > 0 ? wide - 4 : 4, Math.PI)
    else place(defender, -25, 12)
  }
  handOver(world, shooter)
  place(world.teams[BLUE].keeper, GOAL_X - 1, 0, Math.PI)
  for (let i = 0; i < 120; i++) {
    hold()
    stepMatch(world)
  }
  hold()
  Passer.nextLook[shooter] = 0
  return world
}

/**
 * Shots per measurement: at 200 the rate from one spot swung by ±6 points
 * between seeds, too much to compare spots or grades reliably.
 */
const SHOTS = 1000

/** Share of `n` shots from the spot that go in. */
function scored(n: number, distance: number, wide: number, grades: GradeOverrides = {}, pressure = Infinity): number {
  let goals = 0
  for (let i = 0; i < n; i++) {
    const world = chance(100 + i, distance, wide, grades, pressure)
    let outcome = ''
    world.onEvent = (e) => {
      if (!outcome && ['goal', 'caught', 'parried', 'wide', 'over', 'blocked'].includes(e.kind)) outcome = e.kind
    }
    requestShot(world)
    for (let t = 0; t < 600 && !outcome; t++) stepMatch(world)
    if (outcome === 'goal') goals++
  }
  return goals / n
}

describe('finishing against a set keeper', () => {
  const curve = [6, 10, 14, 18, 22].map((distance) => ({ distance, rate: scored(SHOTS, distance, 0) }))
  const near = curve[1].rate

  test('an average finisher, free in the middle, scores as measured, and no more than a typical xG curve', () => {
    // Measured over 3000 shots a spot, three seed blocks pooled: 38/23/13/10/5% from 6/10/14/18/22 m; these 1000
    // come to 35/22/13/11/5%. The threat map's shotChance, a typical expected-goals curve, reckons 58/32/18/11/7%:
    // close in, that runs above a free strike now that shots go off line as slanted, and as wide, as real ones.
    const measured = [0.38, 0.23, 0.13, 0.1, 0.05]
    curve.forEach(({ distance, rate }, i) => {
      expect(Math.abs(rate - measured[i])).toBeLessThan(0.04)
      expect(rate).toBeLessThan(shotChance(SMALL_SIDED_PITCH, GOAL_X - distance, 0) + 0.02)
    })
  })

  test('the further out, the fewer go in', () => {
    for (let i = 1; i < curve.length; i++) expect(curve[i].rate).toBeLessThan(curve[i - 1].rate)
    expect(curve[curve.length - 1].rate).toBeLessThan(curve[0].rate - 0.25)
  })

  test('a better finisher scores more', () => {
    // Measured over 3000 shots at 30% for a grade 18 and 15% for a grade 4 from 10 m.
    const grades = (shooting: number): GradeOverrides => ({ red: { outfielder: { shooting } } })
    expect(scored(SHOTS, 10, 0, grades(18))).toBeGreaterThan(scored(SHOTS, 10, 0, grades(4)) + 0.1)
  }, 20_000)

  test('a quicker keeper keeps more out', () => {
    // Measured over 3000 shots at 4.7% against a grade 18 and 17% against a grade 4 from 14 m.
    const grades = (reaction: number): GradeOverrides => ({ blue: { keeper: { reaction } } })
    expect(scored(SHOTS, 14, 0, grades(18))).toBeLessThan(scored(SHOTS, 14, 0, grades(4)) - 0.08)
  }, 20_000)

  test('a shot hurried by a defender goes in less often', () => {
    // Measured over 3000 shots at 9.4% with a defender a metre off, against 23% free.
    expect(scored(SHOTS, 10, 0, {}, 1)).toBeLessThan(near - 0.1)
  }, 20_000)
})

describe('the shooter’s judgement', () => {
  test('they reckon a shot about as likely to go in as it is', () => {
    let reckoned = 0
    for (let i = 0; i < SHOTS; i++) {
      const world = chance(100 + i, 10, 0)
      reckoned += shotValue(world, world.carrier)
    }
    // Measured at 22.9% reckoned against 23.4% scored over 3000 shots.
    expect(Math.abs(reckoned / SHOTS - scored(SHOTS, 10, 0))).toBeLessThan(0.06)
  }, 20_000)

  test('closed down near goal, a shot is worth more than holding on; free 20 m out, carrying on is', () => {
    const closed = chance(1, 9, 0, {}, 1)
    expect(shotValue(closed, closed.carrier)).toBeGreaterThan(keepValue(closed, closed.carrier))
    const free = chance(1, 20, 0)
    expect(keepValue(free, free.carrier)).toBeGreaterThan(shotValue(free, free.carrier))
  })

  test('out by the corner flag, a shot at goal is next to worthless, and next to never goes in', () => {
    // Along the goal line, a sliver off line is metres across the goal mouth.
    const flag = chance(1, 0.5, 18)
    expect(shotValue(flag, flag.carrier)).toBeLessThan(0.01)
    expect(scored(200, 0.5, 18)).toBeLessThan(0.03)
  }, 20_000)

  test('struck first time, a shot goes less true than from a ball they have set, and they know it', () => {
    const world = chance(1, 14, 0)
    expect(planShot(world, world.carrier, -1, true).error).toBeGreaterThan(1.3 * planShot(world, world.carrier).error)
    expect(shotValue(world, world.carrier, true)).toBeLessThan(shotValue(world, world.carrier))
  })

  test('they reckon on hitting the legs of anyone they have seen in the way, but not of anyone only wide shots would hit', () => {
    const world = chance(1, 14, 0)
    const shooter = world.carrier
    const open = shotValue(world, shooter)
    const { aim } = planShot(world, shooter, shooter)
    const bx = Position.x[world.ball]
    const by = Position.y[world.ball]
    const halfway = (bx + GOAL_X) / 2
    // Halfway to goal, just outside the line to the post they're aiming inside: only shots going wide would hit them.
    const postLine = by + (Math.sign(aim.y) * (GOAL_HALF_WIDTH - BALL_RADIUS) - by) / 2
    place(world.teams[BLUE].outfielders[0], halfway, postLine + Math.sign(aim.y) * 0.65, Math.PI)
    lookAround(world)
    expect(shotValue(world, shooter)).toBeCloseTo(open, 6)
    // Halfway to where they'd aim, just off the line to it: in the way.
    place(world.teams[BLUE].outfielders[1], halfway, (by + aim.y) / 2 + 0.3, Math.PI)
    expect(shotValue(world, shooter)).toBeCloseTo(open, 6)
    lookAround(world)
    expect(shotValue(world, shooter)).toBeLessThan(0.7 * open)
  })
})

describe('the keeper narrows the angle', () => {
  const keeperAt = (world: Match) => ({ x: Position.x[world.teams[BLUE].keeper], y: Position.y[world.teams[BLUE].keeper] })

  test('they stand further off their line the further away the ball is, and nearer it close in', () => {
    const far = keeperAt(chance(1, 20, 0, {}, Infinity, true))
    const near = keeperAt(chance(1, 10, 0, {}, Infinity, true))
    expect(GOAL_X - far.x).toBeGreaterThan(GOAL_X - near.x + 1)
  })

  test('from out wide they cover the near post, on the line splitting the angle', () => {
    const keeper = keeperAt(chance(1, 10, 8, {}, Infinity, true))
    expect(keeper.y).toBeGreaterThan(0.5)
    // On the bisector of the angle between the ball and the posts: equal angles to each post.
    const ball = { x: GOAL_X - 10, y: 8 }
    const toKeeper = Math.atan2(keeper.y - ball.y, keeper.x - ball.x)
    const toNear = Math.atan2(3.66 - ball.y, GOAL_X - ball.x)
    const toFar = Math.atan2(-3.66 - ball.y, GOAL_X - ball.x)
    expect(Math.abs(toNear - toKeeper - (toKeeper - toFar))).toBeLessThan(0.1)
  })

  test('with the shooter through on their own, they come out to close them down', () => {
    const through = keeperAt(chance(1, 12, 0))
    const covered = keeperAt(chance(1, 12, 0, {}, Infinity, true))
    expect(GOAL_X - through.x).toBeGreaterThan(GOAL_X - covered.x + 1.5)
  })
})

describe('review fixes', () => {
  test('the chance a shot lands in the open goal matches where shots actually land, low ones included', () => {
    // A low shot with a big miss: plenty hit the ground first, and stay in.
    const aim = { y: 1, z: 0.35 }
    const miss = 1
    const rng = createRng(4)
    let inside = 0
    for (let i = 0; i < 20000; i++) {
      const t = sampleShotTarget(rng, aim, miss)
      if (Math.abs(t.y) <= GOAL_HALF_WIDTH - BALL_RADIUS && t.z <= GOAL_HEIGHT - BALL_RADIUS) inside++
    }
    expect(Math.abs(landingChance(aim, miss, null) - inside / 20000)).toBeLessThan(0.02)
  })

  test('with the ball past a keeper who came out, the goal is open', () => {
    const world = chance(1, 1, 0)
    // The keeper came out and has been beaten: they're 6 m out, behind the ball, and the shooter has seen it.
    setVec(Position, world.teams[BLUE].keeper, GOAL_X - 6, 0, 0)
    lookAround(world)
    expect(shotValue(world, world.carrier)).toBeGreaterThan(0.5)
  })

  test('however wild the shot, the expected miss is a sensible distance', () => {
    // The worst finisher, hurried, facing their own goal, from 25 m.
    const world = chance(1, 25, 0, { red: { outfielder: { shooting: 1 } } }, 1)
    Facing.angle[world.carrier] = Math.PI
    const { miss } = planShot(world, world.carrier)
    expect(miss).toBeGreaterThan(0)
    expect(miss).toBeLessThan(25)
  })

  test('a shooter judges the lane clear from where they last saw everyone, not where they are', () => {
    const world = chance(1, 14, 0)
    const shooter = world.carrier
    const goalX = attackedGoalX(world.pitch, RED)
    expect(laneClear(world, goalX, shooter)).toBe(true)
    // Defenders step into the lanes to either corner after the shooter's last look: not as far as they know.
    place(world.teams[BLUE].outfielders[0], GOAL_X - 7, 1.5, Math.PI)
    place(world.teams[BLUE].outfielders[1], GOAL_X - 7, -1.5, Math.PI)
    expect(laneClear(world, goalX, shooter)).toBe(true)
    lookAround(world)
    expect(laneClear(world, goalX, shooter)).toBe(false)
  })
})

import { describe, expect, test } from 'bun:test'
import { Dribbler, Facing, Position, Velocity } from './components'
import { BALL_RADIUS } from './constants'
import type { Cue } from './cues'
import { dropPoint, launchUp, loftFlightTime } from './flight'
import { controlTime } from './grades'
import { createMatch, handOver, setVec, stepMatch, type GradeOverrides, type Match } from './match'
import { rollSpeedFor } from './passing'
import { lookAround } from './perception'
import { FULL_PITCH } from './pitch'
import { passOptions, strikePass, type PassOption } from './playmaking'
import { loftSafety, passSafety } from './space/control'
import { ballSystem } from './systems/ball'
import { FOOT_OFFSET } from './touch'

const RED = 0
const BLUE = 1
const L = FULL_PITCH.halfLength

function place(eid: number, x: number, y: number, facing = 0) {
  setVec(Position, eid, x, y, 0)
  setVec(Velocity, eid, 0, 0, 0)
  Facing.angle[eid] = facing
}

/**
 * Two a side on a full-size pitch: Red's first outfielder on the ball at
 * (x, y) facing towards (mx, my), where their teammate stands; Blue's
 * outfielders wherever given, otherwise deep in their own half, out wide.
 * Everyone has had a look at where everyone else is.
 */
function scene(seed: number, x: number, y: number, mx: number, my: number, blue: [number, number][] = [], grades: GradeOverrides = {}): Match {
  const world = createMatch({ outfielders: 2, seed, grades, pitch: FULL_PITCH })
  const [carrier, mate] = world.teams[RED].outfielders
  handOver(world, carrier)
  const facing = Math.atan2(my - y, mx - x)
  place(carrier, x, y, facing)
  setVec(Position, world.ball, x + Math.cos(facing) * FOOT_OFFSET, y + Math.sin(facing) * FOOT_OFFSET, BALL_RADIUS)
  setVec(Velocity, world.ball, 0, 0, 0)
  place(mate, mx, my, Math.PI)
  const spots: [number, number][] = [...blue, [45, 30], [45, -30]]
  world.teams[BLUE].outfielders.forEach((eid, i) => place(eid, spots[i][0], spots[i][1], Math.PI))
  lookAround(world)
  return world
}

/** A lofted pass from the ball to (x, y), for `receiver`. */
function loft(world: Match, receiver: number, x: number, y: number): PassOption {
  const distance = Math.hypot(x - Position.x[world.ball], y - Position.y[world.ball])
  const flight = loftFlightTime(distance)
  return { receiver, kind: 'feet', x, y, speed: distance / flight, flight, safety: 1, value: 1 }
}

/** Steps `world` until `done` or `seconds` have passed. */
function playOn(world: Match, seconds: number, done: () => boolean = () => false) {
  for (let i = 0; i < seconds * 120 && world.phase === 'play' && !done(); i++) stepMatch(world)
}

/** Counts the cues of `kind` from now on. */
function countCues(world: Match, kind: Cue['kind'], about: (c: Cue) => boolean = () => true) {
  const counter = { n: 0 }
  const previous = world.onCue
  world.onCue = (c) => {
    previous?.(c)
    if (c.kind === kind && about(c)) counter.n++
  }
  return counter
}

describe('a ball in the air', () => {
  test('lands where its flight says it will, and is read there all the way down', () => {
    const world = scene(1, -20, 0, 20, 0)
    const distance = 40
    const flight = loftFlightTime(distance)
    setVec(Position, world.ball, 0, 0, BALL_RADIUS)
    setVec(Velocity, world.ball, distance / flight, 0, launchUp(flight))
    let t = 0
    let read = NaN
    while (t < flight / 2 || Position.z[world.ball] > BALL_RADIUS) {
      ballSystem(world, 1 / 120)
      t += 1 / 120
      if (Number.isNaN(read) && t >= flight / 2) read = dropPoint(world)!.x
    }
    expect(Position.x[world.ball]).toBeCloseTo(distance, 0)
    expect(t).toBeCloseTo(flight, 1)
    expect(read).toBeCloseTo(distance, 0)
  })

  test('takes pace off as it bounces, more the harder it comes down', () => {
    const world = scene(1, -20, 0, 20, 0)
    const bounce = (down: number) => {
      setVec(Position, world.ball, 0, 0, BALL_RADIUS + 0.001)
      setVec(Velocity, world.ball, 15, 0, -down)
      ballSystem(world, 1 / 120)
      return Velocity.x[world.ball]
    }
    expect(bounce(12)).toBeLessThan(bounce(3))
    expect(bounce(3)).toBeLessThan(15)
    expect(bounce(0.5)).toBeGreaterThan(14.8)
  })
})

describe('striking a lofted pass', () => {
  /** How far, on average over many strikes, a lofted pass of `distance` m comes down from where it was aimed. */
  function meanMiss(passing: number, distance: number) {
    let total = 0
    const strikes = 150
    for (let seed = 0; seed < strikes; seed++) {
      const world = scene(seed, -20, 0, -20 + distance, 0, [], { red: { outfielder: { passing } } })
      const [carrier, mate] = world.teams[RED].outfielders
      const x = -20 + FOOT_OFFSET + distance
      strikePass(world, carrier, loft(world, mate, x, 0))
      const drop = dropPoint(world)!
      total += Math.hypot(drop.x - x, drop.y)
    }
    return total / strikes
  }

  test('drops nearer the mark the better the passer, and strays further the longer it is', () => {
    const best = meanMiss(20, 40)
    const worst = meanMiss(1, 40)
    expect(best).toBeLessThan(worst * 0.5)
    expect(meanMiss(10, 20)).toBeLessThan(meanMiss(10, 45))
  })
})

describe('how safe a lofted pass is', () => {
  test('an opponent under its flight can’t reach it, though he’d cut out the same pass along the ground', () => {
    const world = scene(2, -20, 0, 20, 0, [[0, 0.5]])
    const [, mate] = world.teams[RED].outfielders
    const bx = Position.x[world.ball]
    const ground = passSafety(world, RED, bx, 0, 20, 0, rollSpeedFor(40, 6), -1, mate)
    const lofted = loftSafety(world, RED, bx, 0, 20, 0, loftFlightTime(40), mate)
    expect(ground).toBeLessThan(0.3)
    expect(lofted).toBeGreaterThan(0.9)
  })

  test('an opponent close in front of the passer can block it on its way up', () => {
    // Scenes share the component stores, so each is rated as soon as it's set.
    const rate = (blue: [number, number][]) => {
      const world = scene(3, -20, 0, 20, 0, blue)
      const [, mate] = world.teams[RED].outfielders
      return loftSafety(world, RED, Position.x[world.ball], 0, 20, 0, loftFlightTime(40), mate)
    }
    expect(rate([])).toBeGreaterThan(0.9)
    expect(rate([[-17.5, 0.3]])).toBeLessThan(0.6)
  })

  test('with an opponent where it comes down, it’s a jump for it, which the better header is likelier to win', () => {
    const marked = (heading: number) => {
      const world = scene(4, -20, 0, 20, 0, [[21, 0.5]], { red: { outfielder: { heading } }, blue: { outfielder: { heading: 10 } } })
      const [, mate] = world.teams[RED].outfielders
      return loftSafety(world, RED, Position.x[world.ball], 0, 20, 0, loftFlightTime(40), mate)
    }
    expect(marked(10)).toBeGreaterThan(0.2)
    expect(marked(10)).toBeLessThan(0.75)
    expect(marked(20)).toBeGreaterThan(marked(10) + 0.1)
    expect(marked(1)).toBeLessThan(marked(10) - 0.1)
  })

  test('is offered over a defender who has cut the ground pass', () => {
    const world = scene(5, -20, 0, 20, 0, [[0, 0.5], [30, 10]])
    const [, mate] = world.teams[RED].outfielders
    const options = passOptions(world, world.carrier).filter((o) => o.receiver === mate && o.kind === 'feet')
    const ground = options.find((o) => o.flight === 0)!
    const lofted = options.find((o) => o.flight > 0)!
    expect(lofted.safety).toBeGreaterThan(ground.safety + 0.3)
  })
})

describe('receiving a dropping ball', () => {
  test('a teammate on their own brings it down and has it, a moment later than a ball along the ground', () => {
    const world = scene(6, -20, 0, 15, 0, [], { red: { outfielder: { passing: 20, firstTouch: 20 } } })
    const [carrier, mate] = world.teams[RED].outfielders
    strikePass(world, carrier, loft(world, mate, 15, 0))
    playOn(world, 5, () => world.pass === null)
    expect(world.stats[RED].completed).toBe(1)
    expect(world.carrier).toBe(mate)
    expect(Position.z[world.ball]).toBeLessThan(0.5)
    expect(Dribbler.cooldown[mate]).toBeGreaterThan(controlTime(20))
  })

  test('the better the first touch, the more often it’s brought under control rather than getting away', () => {
    const spills = (firstTouch: number) => {
      let n = 0
      for (let seed = 0; seed < 40; seed++) {
        const world = scene(seed, -20, 0, 20, 0, [], { red: { outfielder: { passing: 20, firstTouch } } })
        const [carrier, mate] = world.teams[RED].outfielders
        const loose = countCues(world, 'loose', (c) => c.kind === 'loose' && c.player === mate)
        strikePass(world, carrier, loft(world, mate, 20, 0))
        playOn(world, 5, () => world.pass === null)
        n += loose.n
      }
      return n
    }
    const clumsy = spills(1)
    const deft = spills(20)
    expect(clumsy).toBeGreaterThan(deft + 5)
  })
})

describe('contests in the air', () => {
  test('a defender alone under it heads it away, and their side comes away with it more often than not', () => {
    let blueAfter = 0
    let completed = 0
    const tries = 30
    for (let seed = 0; seed < tries; seed++) {
      // The receiver is too far from where it comes down to get there; the defender is right under it.
      const world = scene(seed, -20, 0, 5, 25, [[20, 0], [30, 10]])
      const [carrier, mate] = world.teams[RED].outfielders
      strikePass(world, carrier, loft(world, mate, 20, 0))
      playOn(world, 4, () => world.pass === null)
      completed += world.stats[RED].completed
      playOn(world, 1)
      if (world.possession === BLUE) blueAfter++
    }
    expect(completed).toBe(0)
    expect(blueAfter).toBeGreaterThan(tries / 2)
  })

  test('a cross met by an attacker and a defender together goes to the better in the air more often', () => {
    const attackerWins = (attacker: number, defender: number) => {
      let won = 0
      for (let seed = 0; seed < 50; seed++) {
        const world = scene(seed, L - 12, -30, L - 14, 0, [[L - 13.4, 0.4], [L - 5, 15]], {
          red: { outfielder: { passing: 20, heading: attacker } },
          blue: { outfielder: { heading: defender } },
        })
        const [carrier, mate] = world.teams[RED].outfielders
        strikePass(world, carrier, loft(world, mate, L - 14, 0))
        playOn(world, 4, () => world.pass === null)
        won += world.stats[RED].completed
      }
      return won
    }
    expect(attackerWins(20, 1)).toBeGreaterThan(attackerWins(1, 20) + 10)
  })

  test('the keeper comes for a ball dropping in the six-yard box and claims it', () => {
    let claimed = 0
    const tries = 20
    for (let seed = 0; seed < tries; seed++) {
      const world = scene(seed, L - 14, -28, L - 10, -6, [[L - 8, 8], [L - 25, -15]], { red: { outfielder: { passing: 20 } } })
      const [carrier, mate] = world.teams[RED].outfielders
      let held = false
      const previous = world.onEvent
      world.onEvent = (e) => {
        previous?.(e)
        if (e.kind === 'claimed' && e.team === BLUE) held = true
      }
      strikePass(world, carrier, loft(world, mate, L - 4, 0))
      playOn(world, 4, () => held)
      if (held) claimed++
    }
    expect(claimed).toBeGreaterThan(tries * 0.7)
  })
})

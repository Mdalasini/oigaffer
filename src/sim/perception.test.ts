import { describe, expect, test } from 'bun:test'
import { Call, CallKind, Facing, Outfielder, Position, Velocity } from './components'
import { BALL_RADIUS } from './constants'
import { createMatch, handOver, setVec, type Match } from './match'
import { knows, lookAround, maybeScanBeforeReceiving, perceptionSystem, seenX, sinceScan } from './perception'
import { timeOnBall } from './space/control'
import { FOOT_OFFSET } from './touch'

const RED = 0
const BLUE = 1
const DT = 1 / 120

function place(eid: number, x: number, y: number, facing = 0) {
  setVec(Position, eid, x, y, 0)
  setVec(Velocity, eid, 0, 0, 0)
  Facing.angle[eid] = facing
}

/** Red's first two outfielders and Blue's first, placed where given, all having had a look round; everyone else far off. */
function scene(seed: number, red: [number, number, number][], blue: [number, number, number][], vision = 12): Match {
  const world = createMatch({ outfielders: 2, seed, grades: { red: { outfielder: { vision } } } })
  handOver(world, world.teams[RED].outfielders[0])
  world.teams[RED].outfielders.forEach((eid, i) => place(eid, ...red[i]))
  world.teams[BLUE].outfielders.forEach((eid, i) => place(eid, ...(blue[i] ?? [25, 15 - 30 * i, Math.PI])))
  const carrier = world.teams[RED].outfielders[0]
  setVec(Position, world.ball, Position.x[carrier] + FOOT_OFFSET, Position.y[carrier], BALL_RADIUS)
  lookAround(world)
  return world
}

/** Runs only the perception system for `seconds`, everyone standing where they are. */
function watch(world: Match, seconds: number, until: () => boolean = () => false): number {
  for (let t = 0; t < seconds; t += DT) {
    world.time += DT
    perceptionSystem(world, DT)
    if (until()) return t
  }
  return seconds
}

describe('what players know', () => {
  test('someone in front is kept up to date within a tenth of a second; behind, they go stale', () => {
    const world = scene(1, [[0, 0, 0], [-10, 0, 0]], [[8, 3, Math.PI], [-8, -3, 0]])
    const [carrier] = world.teams[RED].outfielders
    const [ahead, behind] = world.teams[BLUE].outfielders
    // Both move two metres; the carrier faces +x.
    place(ahead, 8, 5, Math.PI)
    place(behind, -8, -1, 0)
    Outfielder.vision[carrier] = 1
    world.memory.nextScan[world.memory.index[carrier]] = Infinity
    watch(world, 0.1)
    expect(seenX(world, carrier, ahead)).toBe(Position.x[ahead])
    expect(Math.abs(world.memory.y[world.memory.index[carrier] * world.memory.players.length + world.memory.index[ahead]] - 5)).toBeLessThan(1e-9)
    expect(Math.abs(world.memory.y[world.memory.index[carrier] * world.memory.players.length + world.memory.index[behind]] - -3)).toBeLessThan(1e-9)
  })

  test('a teammate calling for it is heard wherever they are', () => {
    const world = scene(2, [[0, 0, 0], [-10, 5, 0]], [])
    const [carrier, mate] = world.teams[RED].outfielders
    world.memory.nextScan[world.memory.index[carrier]] = Infinity
    world.time += 10
    expect(knows(world, carrier, mate)).toBe(false)
    Call.kind[mate] = CallKind.Feet
    watch(world, 0.1)
    expect(knows(world, carrier, mate)).toBe(true)
  })

  test('better vision scans more often, so finds a teammate who has moved behind them sooner', () => {
    const found = (vision: number) => {
      let total = 0
      for (let seed = 1; seed <= 60; seed++) {
        const world = scene(seed, [[0, 0, 0], [-6, 6, 0]], [], vision)
        const [carrier, mate] = world.teams[RED].outfielders
        place(mate, -6, -6)
        total += watch(world, 20, () => Math.abs(seenX(world, carrier, mate) - -6) < 1e-9 && Math.abs(world.memory.y[world.memory.index[carrier] * world.memory.players.length + world.memory.index[mate]] + 6) < 1e-9)
      }
      return total / 60
    }
    const sharp = found(20)
    const poor = found(1)
    // Scans come about every 1.7 s at 20 and every 6.7 s at 1.
    expect(sharp).toBeLessThan(2.5)
    expect(poor).toBeGreaterThan(sharp * 2.5)
  })

  test('better vision checks over the shoulder before receiving more often', () => {
    const scans = (vision: number) => {
      let n = 0
      for (let seed = 1; seed <= 200; seed++) {
        const world = scene(seed, [[0, 0, 0], [-6, 6, 0]], [], vision)
        const [, mate] = world.teams[RED].outfielders
        const before = world.memory.nextScan[world.memory.index[mate]]
        maybeScanBeforeReceiving(world, mate)
        if (world.memory.nextScan[world.memory.index[mate]] < before && world.memory.nextScan[world.memory.index[mate]] <= world.time + 0.2) n++
      }
      return n / 200
    }
    expect(scans(20)).toBeGreaterThan(scans(1) + 0.5)
  })

  test('a carrier who hasn’t seen a defender closing in from behind thinks they have more time than they do', () => {
    const world = scene(3, [[0, 0, 0], [-15, 10, 0]], [[-12, 0, 0]])
    const [carrier] = world.teams[RED].outfielders
    const [presser] = world.teams[BLUE].outfielders
    world.memory.nextScan[world.memory.index[carrier]] = Infinity
    // The presser closes to three metres behind them, at a run, while the carrier faces away.
    place(presser, -3, 0, 0)
    Velocity.x[presser] = 6
    watch(world, 0.5)
    expect(timeOnBall(world, carrier, carrier)).toBeGreaterThan(timeOnBall(world, carrier) + 1)
    lookAround(world)
    expect(timeOnBall(world, carrier, carrier)).toBeCloseTo(timeOnBall(world, carrier), 6)
    expect(sinceScan(world, carrier)).toBe(0)
  })
})

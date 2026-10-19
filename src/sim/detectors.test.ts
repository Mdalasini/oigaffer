import { describe, expect, test } from 'bun:test'
import { Mark, OffBall, Position, Team, TouchStyle, Velocity } from './components'
import { createDetectors, LOOK_EVERY, watchFor, type Detector } from './detectors'
import { createMatch, setVec, stepMatch, type Match } from './match'
import { playBack, ticksAt, type Replay } from './replay'
import { stateHash } from './state'

const detector = (name: string): Detector => createDetectors().find((d) => d.name === name)!

/** A match in open play with everyone stood still, red on the ball: red's first outfielder carries, blue's first presses. */
function scene(): Match {
  const world = createMatch({ seed: 1, outfielders: 4 })
  for (const team of world.teams) for (const eid of [...team.outfielders, team.keeper]) setVec(Velocity, eid, 0, 0, 0)
  world.carrier = world.teams[0].outfielders[0]
  world.presser = world.teams[1].outfielders[0]
  world.pass = null
  world.phase = 'play'
  // Everyone well apart, away from the ball, unless a test puts them somewhere.
  world.teams.forEach((team, t) => team.outfielders.forEach((eid, i) => setVec(Position, eid, (t ? 1 : -1) * (5 + 8 * i), 15 - 10 * i, 0)))
  setVec(Position, world.carrier, 0, 0, 0)
  setVec(Position, world.ball, 0.5, 0, 0.11)
  setVec(Velocity, world.ball, 0, 0, 0)
  return world
}

describe('detectors', () => {
  test('two teammates closing on a loose ball are a double chase; the cover running alongside it is not', () => {
    const d = detector('doubleChase')
    const world = scene()
    const [, a, b] = world.teams[0].outfielders
    setVec(Position, world.ball, 10, 0, 0.11)
    setVec(Position, a, 0, 5, 0)
    setVec(Position, b, 0, -5, 0)
    setVec(Velocity, a, 6, -3, 0)
    setVec(Velocity, b, 6, 3, 0)
    for (const eid of [a, b]) {
      OffBall.targetX[eid] = 10
      OffBall.targetY[eid] = 0
    }
    expect(d.look(world).get('0')?.players.sort()).toEqual([a, b].sort())
    // Running the same way, but to a place in the block 8 m short of the ball, b isn't after it.
    OffBall.targetX[b] = 2
    expect(d.look(world).size).toBe(0)
    OffBall.targetX[b] = 10
    // Shifting across with the block, well off the ball's line, isn't chasing it either.
    setVec(Velocity, b, 2, 6, 0)
    expect(d.look(world).size).toBe(0)
    setVec(Velocity, b, 6, 3, 0)
    // The cover running to his spot behind the ball isn't chasing it.
    Mark.cover[b] = 1
    expect(d.look(world).size).toBe(0)
    Mark.cover[b] = 0
    // The ball rolling away as fast as b runs alongside it: b isn't closing on it.
    setVec(Velocity, world.ball, 6, 0, 0)
    setVec(Velocity, b, 6, 0, 0)
    expect(d.look(world).size).toBe(0)
  })

  test('going back and forth is dithering; turning round once, or a wide arc, is not', () => {
    const world = scene()
    const eid = world.teams[0].outfielders[2]
    /** Runs at 3 m/s for 4 s, changing direction every second; heading(i) is the way they go in the i-th second. */
    const run = (heading: (second: number) => number) => {
      const d = detector('dithering')
      let found = false
      for (let i = 0; i < 40; i++) {
        world.time += LOOK_EVERY
        const h = heading(Math.floor(i / 10))
        Position.x[eid] += 3 * Math.cos(h) * LOOK_EVERY
        Position.y[eid] += 3 * Math.sin(h) * LOOK_EVERY
        found ||= d.look(world).has(`${eid}`)
      }
      return found
    }
    expect(run((second) => (second >= 2 ? Math.PI : 0))).toBe(false)
    expect(run((second) => (second * Math.PI) / 4)).toBe(false)
    expect(run((second) => (second % 2) * Math.PI)).toBe(true)
  })

  test('a marker well away from his man, who is goal-side of him in his half, has lost him', () => {
    const d = detector('lostMan')
    const world = scene()
    const marker = world.teams[1].outfielders[2]
    const man = world.teams[0].outfielders[2]
    // Blue defends the goal at +x.
    Mark.target[marker] = man
    Mark.cover[marker] = 0
    setVec(Position, marker, 10, 0, 0)
    setVec(Position, man, 20, 2, 0)
    expect(d.look(world).get(`${marker}`)?.players).toEqual([marker, man])
    // Sprinting back towards goal, he's recovering, not lost.
    setVec(Velocity, marker, 6, 0, 0)
    expect(d.look(world).size).toBe(0)
    setVec(Velocity, marker, 0, 0, 0)
    setVec(Position, man, 13, 2, 0)
    expect(d.look(world).size).toBe(0)
  })

  test('a presser standing off the ball is idle; one closing it down is not', () => {
    const d = detector('idlePresser')
    const world = scene()
    setVec(Position, world.presser, 6, 0, 0)
    expect(d.look(world).size).toBe(1)
    setVec(Velocity, world.presser, -4, 0, 0)
    expect(d.look(world).size).toBe(0)
  })

  test('the ball going out off the carrier’s own touch is dribbled out; off an opponent’s, it is not', () => {
    const d = detector('dribbledOut')
    const world = scene()
    const carrier = world.carrier
    world.lastTouch = { by: carrier, style: TouchStyle.Small, time: world.time, x: 0, y: 0 }
    world.lastTouchedBy = carrier
    world.event = { kind: 'out', team: 1 - Team.id[carrier], time: world.time }
    expect(d.look(world).size).toBe(1)
    world.lastTouchedBy = world.presser
    expect(d.look(world).size).toBe(0)
  })

  test('three off-ball teammates within a few metres are crowding', () => {
    const d = detector('crowding')
    const world = scene()
    const [, a, b, c] = world.teams[0].outfielders
    setVec(Position, a, -10, 0, 0)
    setVec(Position, b, -12, 2, 0)
    setVec(Position, c, -12, -2, 0)
    expect(d.look(world).size).toBe(1)
    setVec(Position, c, -12, -9, 0)
    expect(d.look(world).size).toBe(0)
  })

  test('a crowd is found even with others nearby who are close to only some of it', () => {
    const d = detector('crowding')
    const world = createMatch({ seed: 1, outfielders: 10 })
    world.phase = 'play'
    world.carrier = world.teams[1].outfielders[0]
    world.presser = world.teams[0].outfielders[0]
    world.teams.forEach((team, t) => team.outfielders.forEach((eid, i) => setVec(Position, eid, (t ? 1 : -1) * (4 + 4 * (i % 5)), -18 + 9 * Math.floor(i / 5) + (t ? 0 : 30), 0)))
    const [, a, b, c, e, f, g] = world.teams[0].outfielders
    const spots: [number, number, number][] = [[a, 0, 0], [b, 4, 0], [c, 2, 3], [e, -4, 0], [f, 8, 0], [g, 2, 7]]
    for (const [eid, x, y] of spots) setVec(Position, eid, x - 30, y, 0)
    expect(d.look(world).get(`0:${[a, b, c].sort((x, y) => x - y).join(',')}`)).toBeDefined()
  })

  test('an oddity counts only once it has lasted long enough', () => {
    const world = scene()
    const watch = watchFor(world, [detector('idlePresser')])
    setVec(Position, world.presser, 6, 0, 0)
    for (let t = 0; t < 0.5; t += LOOK_EVERY) {
      world.time += LOOK_EVERY
      watch.look()
    }
    setVec(Velocity, world.presser, -4, 0, 0)
    watch.look()
    expect(watch.findings).toHaveLength(0)
    setVec(Velocity, world.presser, 0, 0, 0)
    for (let t = 0; t < 1.5; t += LOOK_EVERY) {
      world.time += LOOK_EVERY
      watch.look()
    }
    watch.finish()
    expect(watch.findings).toHaveLength(1)
    expect(watch.findings[0].to - watch.findings[0].from).toBeGreaterThanOrEqual(1)
  })

  test('watching a match never changes it', () => {
    const replay: Replay = { seed: 4, outfielders: 4, inputs: [] }
    const plain = playBack(replay, (_, tick) => tick < ticksAt(60))
    const quiet = stateHash(plain)
    const world = createMatch({ seed: 4, outfielders: 4 })
    const watch = watchFor(world)
    for (let tick = 1; tick <= ticksAt(60); tick++) {
      stepMatch(world)
      if (tick % ticksAt(LOOK_EVERY) === 0) watch.look()
    }
    expect(stateHash(world)).toBe(quiet)
  })
})

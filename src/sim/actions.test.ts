import { describe, expect, test } from 'bun:test'
import { recordActions, summarise, METRIC_KEYS, SHARE_KEYS, type ActionLog } from './actions'
import { Facing, Position, Team, Velocity } from './components'
import { BALL_RADIUS } from './constants'
import { createMatch, requestShot, setVec, stepMatch, type Match } from './match'
import { attackedGoalX, opponent } from './teams'
import { FOOT_OFFSET } from './touch'

const MINUTES = 3

/** Plays `MINUTES` of a 10-a-side match, recording as it goes. */
function play(world: Match) {
  const rec = recordActions(world)
  while (world.time < MINUTES * 60) {
    stepMatch(world)
    rec.afterStep()
  }
  return { log: rec.finish() }
}

// One match, played once, shared by the tests below.
const world = createMatch({ seed: 1, outfielders: 10 })
const { log } = play(world)

describe('recordActions', () => {
  const L = log.pitch.halfLength
  const [red, blue] = [0, 1].map((team) => world.stats[team])

  test('passes and completions match the stats', () => {
    expect(log.passes.length).toBe(red.passes + blue.passes)
    expect(log.passes.filter((p) => p.completed).length).toBe(red.completed + blue.completed)
  })

  test('shots match the stats', () => {
    expect(log.shots.length).toBe(red.shots + blue.shots)
  })

  test('every pass lies on the pitch', () => {
    for (const p of log.passes) {
      expect(p.fromU).toBeGreaterThanOrEqual(-L - 1)
      expect(p.fromU).toBeLessThanOrEqual(L + 1)
      expect(p.toU).toBeGreaterThanOrEqual(-L - 1)
      expect(p.toU).toBeLessThanOrEqual(L + 1)
    }
  })

  test('possession spells alternate, run forwards and cover the match', () => {
    const { spells } = log
    expect(spells.length).toBeGreaterThan(1)
    for (let i = 0; i < spells.length; i++) {
      expect(spells[i].end).toBeGreaterThanOrEqual(spells[i].start)
      if (i > 0) {
        expect(spells[i].team).not.toBe(spells[i - 1].team)
        expect(spells[i].start).toBe(spells[i - 1].end)
      }
    }
    const total = spells.reduce((a, s) => a + (s.end - s.start), 0)
    expect(Math.abs(total - world.time)).toBeLessThan(0.5)
  })

  test('a shot blocked in the step it is struck is recorded as blocked, not as a goal', () => {
    const scene = createMatch({ seed: 1, outfielders: 10 })
    const rec = recordActions(scene)
    const { carrier, ball } = scene
    const goalX = attackedGoalX(scene.pitch, Team.id[carrier])
    const dir = Math.sign(goalX)
    // Facing goal 20 m out, the ball at their feet and a defender right on it.
    setVec(Position, carrier, goalX - dir * 20, 0, 0)
    setVec(Velocity, carrier, 0, 0, 0)
    Facing.angle[carrier] = dir > 0 ? 0 : Math.PI
    setVec(Position, ball, goalX - dir * (20 - FOOT_OFFSET), 0, BALL_RADIUS)
    setVec(Velocity, ball, 0, 0, 0)
    setVec(Position, scene.teams[opponent(Team.id[carrier])].outfielders[0], goalX - dir * (19.3 - FOOT_OFFSET), 0, 0)
    requestShot(scene)
    stepMatch(scene)
    rec.afterStep()
    expect(scene.stats[Team.id[carrier]].shots).toBe(1)
    expect(scene.event?.kind).toBe('blocked')
    expect(rec.finish().shots.map((s) => s.outcome)).toEqual(['blocked'])
  })

  test('the recorder chains an existing cue handler', () => {
    const fresh = createMatch({ seed: 2, outfielders: 10 })
    let calls = 0
    fresh.onCue = () => {
      calls++
    }
    play(fresh)
    expect(calls).toBeGreaterThan(0)
  })
})

describe('summarise', () => {
  const [red, blue] = summarise(log)

  test('every metric is finite', () => {
    for (const key of METRIC_KEYS) {
      expect(Number.isFinite(red[key])).toBe(true)
      expect(Number.isFinite(blue[key])).toBe(true)
    }
  })

  test('shares lie between 0 and 1', () => {
    for (const key of SHARE_KEYS) {
      for (const side of [red, blue]) {
        expect(side[key]).toBeGreaterThanOrEqual(0)
        expect(side[key]).toBeLessThanOrEqual(1)
      }
    }
  })

  test('possession shares add up to one', () => {
    expect(red.possessionShare + blue.possessionShare).toBeCloseTo(1, 6)
  })

  test('a log with no minutes summarises to zeros rather than NaN', () => {
    const empty: ActionLog = { ...log, minutes: 0, inPlay: 0, passes: [], shots: [], spells: [] }
    const [a, b] = summarise(empty)
    for (const key of METRIC_KEYS) {
      expect(Number.isFinite(a[key])).toBe(true)
      expect(Number.isFinite(b[key])).toBe(true)
    }
  })
})

import { describe, expect, test } from 'bun:test'
import { Game } from '../game/Game'
import { TICK_RATE } from '../sim/constants'
import { label } from '../sim/sim'
import { resimulate, type Flag } from './flag'
import { frameValue } from './recorder'
import { report } from './report'

const CFG = { seed: 11, halfMinutes: 45, formations: ['4-3-3', '3-4-3'] as [string, string] }

function play(game: Game, seconds: number) {
  for (let i = 0; i < seconds * TICK_RATE; i++) game.tick()
}

describe('recorder', () => {
  test('keeps a rolling window and a keyframe that covers its start', () => {
    const game = new Game(CFG)
    play(game, 40)
    expect(game.rec.lastTick()).toBe(game.sim.m.tick)
    expect(game.rec.lastTick() - game.rec.firstTick() + 1).toBe(game.rec.capacity)
    expect(game.rec.keyframeAtOrBefore(game.rec.firstTick())).toBeDefined()
    const ball = game.rec.frame(game.sim.m.tick)
    expect(frameValue(ball, 0, 'x')).toBe(game.sim.c.Pos.x[game.sim.ball])
  })
})

describe('flags', () => {
  test('a flag survives JSON and re-simulates exactly with unchanged code', () => {
    const game = new Game(CFG)
    play(game, 14)
    const subject = game.sim.teams[0][7]
    game.selected = [subject]
    game.scrubTo(game.sim.m.tick - 2 * TICK_RATE)
    const flag: Flag = JSON.parse(JSON.stringify(game.flag('H10 should not be here')))
    expect(flag.subjects).toEqual([label(game.sim, subject)])
    const r = resimulate(flag)
    expect(r.firstDriftTick).toBe(-1)
    expect(r.maxDrift).toBeLessThan(0.001)
  })

  test('the report names the subject and lays out state, map and trace', () => {
    const game = new Game(CFG)
    play(game, 10)
    game.selected = [game.sim.teams[1][9]]
    const text = report(game.flag('check the striker'))
    expect(text).toContain('Note: check the striker')
    expect(text).toContain('Subjects: A9')
    expect(text).toContain('STATE at')
    expect(text).toContain('MAP at')
    expect(text).toContain('TRACE A9 (ST)')
    expect(text).toMatch(/kick pass \w+ -> \w+/)
  })

  test('loading a flag shows the flagged tick with its subjects selected', () => {
    const game = new Game(CFG)
    play(game, 8)
    game.selected = [game.sim.teams[0][3]]
    const flag: Flag = JSON.parse(JSON.stringify(game.flag('')))
    const viewer = new Game(CFG)
    viewer.loadFlag(flag)
    expect(viewer.scrubTick).toBe(flag.flagTick)
    expect(viewer.selected).toEqual(game.selected)
    expect(viewer.sim.m.tick).toBe(flag.frames.firstTick + flag.frames.count - 1)
  })
})

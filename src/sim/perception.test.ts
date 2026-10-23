import { describe, expect, test } from 'bun:test'
import { TICK_RATE } from './constants'
import { on, recentEvents } from './events'
import { newMatch } from './match'
import { intercept } from './movement'
import { age, believe, call, perceptionSystem, revealAll } from './perception'
import { restore, snapshot } from './snapshot'
import { updateScratch } from './brain'
import type { Sim } from './sim'
import { Phase } from './state'
import { step } from './step'

const CFG = { seed: 5, halfMinutes: 45, formations: ['4-3-3', '3-4-3'] as [string, string] }

/** Puts `observer` at the origin facing +x and `target` at (x, y), and freezes scanning. */
function setup(x: number, y: number) {
  const sim = newMatch(CFG)
  const [observer, target] = [sim.teams[0][5], sim.teams[1][5]]
  const { Pos, Facing, Brain } = sim.c
  Pos.x[observer] = 0
  Pos.y[observer] = 0
  Facing.a[observer] = 0
  Brain.nextScan[observer] = 1e9
  Pos.x[target] = x
  Pos.y[target] = y
  return { sim, observer, target }
}

function moveAndSense(sim: Sim, target: number, x: number, y: number) {
  sim.m.tick += TICK_RATE
  sim.c.Pos.x[target] = x
  sim.c.Pos.y[target] = y
  perceptionSystem(sim)
}

describe('perception', () => {
  test('a player tracks what is in front of them', () => {
    const { sim, observer, target } = setup(15, 5)
    moveAndSense(sim, target, 16, 6)
    expect(age(sim, observer, target)).toBe(0)
    expect(believe(sim, observer, target, { x: 0, y: 0, vx: 0, vy: 0 }).x).toBe(16)
  })

  test('a player behind and away from them goes stale until a shoulder check', () => {
    const { sim, observer, target } = setup(-15, 0)
    revealAll(sim)
    moveAndSense(sim, target, -14, 1)
    expect(age(sim, observer, target)).toBeCloseTo(1, 5)
    sim.c.Brain.nextScan[observer] = sim.m.tick + 1
    moveAndSense(sim, target, -13, 1)
    expect(age(sim, observer, target)).toBe(0)
  })

  test('someone right behind is felt without looking', () => {
    const { sim, observer, target } = setup(-2, 0)
    moveAndSense(sim, target, -2.5, 0.5)
    expect(age(sim, observer, target)).toBe(0)
  })

  test('stale sightings extrapolate along the remembered velocity, at most a second', () => {
    const { sim, observer, target } = setup(10, 0)
    sim.c.Vel.x[target] = 2
    perceptionSystem(sim)
    sim.c.Facing.a[observer] = Math.PI
    sim.m.tick += 3 * TICK_RATE
    const b = believe(sim, observer, target, { x: 0, y: 0, vx: 0, vy: 0 })
    expect(b.x).toBeCloseTo(12, 5)
  })

  test('"man on": a teammate warns the carrier about an unseen opponent closing in', () => {
    const { sim, observer: carrier, target: opp } = setup(-3.5, 0)
    sim.m.phase = Phase.Play
    sim.m.ball.owner = carrier
    sim.c.Memory.seen.fill(-100)
    const mate = sim.teams[0][7]
    sim.c.Pos.x[mate] = -12
    sim.c.Pos.y[mate] = 2
    sim.c.Facing.a[mate] = 0
    const calls: number[] = []
    on(sim, 'call', (_s, e) => calls.push(e.about))
    sim.m.tick += 1
    perceptionSystem(sim)
    expect(calls).toEqual([opp])
    expect(age(sim, carrier, opp)).toBe(0)
    expect(recentEvents(sim, 'call')).toHaveLength(1)
  })
})

describe('events', () => {
  test('subscribers hear events as they happen and polling sees this tick and the last', () => {
    const sim = newMatch(CFG)
    const heard: string[] = []
    const off = on(sim, 'phase', (s, e) => heard.push(`${e.phase}@${s.m.tick}`))
    let kickTick = -1
    for (let i = 0; i < 3 * TICK_RATE && kickTick < 0; i++) {
      step(sim)
      if (recentEvents(sim, 'kick').length) kickTick = sim.m.tick
    }
    expect(heard).toEqual([`${Phase.Play}@${kickTick}`])
    step(sim)
    expect(recentEvents(sim, 'kick')).toHaveLength(1)
    step(sim)
    expect(recentEvents(sim, 'kick')).toHaveLength(0)
    off()
    expect(sim.listeners.phase).toHaveLength(0)
  })
})

describe('review regressions', () => {
  test('a player chases where they last saw the ball, not where it really is', () => {
    const { sim, observer } = setup(30, 30)
    sim.m.phase = Phase.Play
    const { Pos, Vel } = sim.c
    Pos.x[sim.ball] = 10
    Pos.y[sim.ball] = 0
    Vel.x[sim.ball] = 0
    perceptionSystem(sim)
    // The ball moves behind the player while they keep facing +x.
    Pos.x[sim.ball] = -20
    sim.m.tick += 1
    perceptionSystem(sim)
    updateScratch(sim)
    const ic = intercept(sim, observer, { t: 0, x: 0, y: 0 })
    expect(ic.x).toBeCloseTo(10, 5)
  })

  test('a listener can unsubscribe itself without others missing the event', () => {
    const sim = newMatch(CFG)
    const heard: string[] = []
    const off = on(sim, 'call', () => {
      heard.push('first')
      off()
    })
    on(sim, 'call', () => heard.push('second'))
    const [a, b] = sim.teams[0]
    call(sim, a, 'man-on', b, -1)
    expect(heard).toEqual(['first', 'second'])
  })

  test('a snapshot with a different set of components is refused', () => {
    const sim = newMatch(CFG)
    const snap = snapshot(sim)
    snap.arrays.pop()
    expect(() => restore(sim, snap)).toThrow()
  })
})

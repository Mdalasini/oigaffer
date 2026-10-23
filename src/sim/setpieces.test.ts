import { describe, expect, test } from 'bun:test'
import { TICK_RATE } from './constants'
import type { SimEvent } from './events'
import { keeperOf } from './keeper'
import { awardFreeKick, awardRestart, newMatch } from './match'
import { CENTRE_CIRCLE_RADIUS, HALF_LENGTH, HALF_WIDTH, PENALTY_AREA_DEPTH, PENALTY_AREA_WIDTH, PENALTY_SPOT_DISTANCE } from './pitch'
import { attackDir, roleOf, type Sim } from './sim'
import { Restart } from './state'
import { step } from './step'

const CFG = { seed: 18, halfMinutes: 45, formations: ['4-3-3', '3-4-3'] as [string, string] }

function run(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = []
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    step(sim)
    out.push(...sim.m.events)
  }
  return out
}

function spot(sim: Sim, eid: number): [number, number] {
  return [sim.c.SetPiece.x[eid], sim.c.SetPiece.y[eid]]
}

describe('corners', () => {
  test('attackers go into the box, defenders take zones, the keeper stays on the line', () => {
    const sim = newMatch(CFG)
    const dir = attackDir(sim, 0)
    awardRestart(sim, Restart.Corner, 0, dir * HALF_LENGTH, HALF_WIDTH)
    const inBox = (x: number, y: number) => x * dir > HALF_LENGTH - PENALTY_AREA_DEPTH && Math.abs(y) < PENALTY_AREA_WIDTH / 2
    const attackersUp = sim.teams[0].filter((e) => sim.c.SetPiece.active[e] && inBox(...spot(sim, e)))
    expect(attackersUp.length).toBeGreaterThanOrEqual(4)
    const [gx] = spot(sim, keeperOf(sim, 1))
    expect(Math.abs(gx)).toBeGreaterThan(HALF_LENGTH - 1)
    expect(sim.teams[1].filter((e) => sim.c.SetPiece.active[e] && inBox(...spot(sim, e))).length).toBeGreaterThanOrEqual(6)
  })

  test('the corner is crossed or played short once everyone is set', () => {
    const sim = newMatch(CFG)
    const dir = attackDir(sim, 0)
    awardRestart(sim, Restart.Corner, 0, dir * HALF_LENGTH, -HALF_WIDTH)
    const awarded = sim.m.tick
    const taker = sim.m.restart.taker
    const kick = run(sim, 14).find((e) => e.type === 'kick')
    expect(kick).toMatchObject({ by: taker })
    expect(kick!.tick - awarded).toBeGreaterThanOrEqual(4 * TICK_RATE)
  })
})

describe('free kicks', () => {
  test('a free kick 20 m out gets a wall 9.15 m from the ball', () => {
    const sim = newMatch(CFG)
    const dir = attackDir(sim, 0)
    const [x, y] = [dir * (HALF_LENGTH - 20), 4]
    awardFreeKick(sim, Restart.FreeKick, 0, x, y, false)
    const wall = sim.teams[1].filter((e) => {
      const [wx, wy] = spot(sim, e)
      return sim.c.SetPiece.active[e] && Math.abs(Math.hypot(wx - x, wy - y) - CENTRE_CIRCLE_RADIUS) < 1.2
    })
    expect(wall.length).toBeGreaterThanOrEqual(3)
  })
})

describe('penalties', () => {
  test('everyone but the taker and keeper is outside the area, and the kick is a shot', () => {
    const sim = newMatch(CFG)
    const dir = attackDir(sim, 0)
    awardFreeKick(sim, Restart.Penalty, 0, dir * (HALF_LENGTH - PENALTY_SPOT_DISTANCE), 0, false)
    const taker = sim.m.restart.taker
    for (const e of sim.players) {
      if (e === taker || e === keeperOf(sim, 1)) continue
      expect(spot(sim, e)[0] * dir).toBeLessThan(HALF_LENGTH - PENALTY_AREA_DEPTH)
    }
    expect(run(sim, 14).find((e) => e.type === 'kick')).toMatchObject({ by: taker, kind: 'shot' })
  })

  test('most penalties are scored, not all', () => {
    let goals = 0
    for (let seed = 1; seed <= 40; seed++) {
      const sim = newMatch({ ...CFG, seed })
      const dir = attackDir(sim, 0)
      awardFreeKick(sim, Restart.Penalty, 0, dir * (HALF_LENGTH - PENALTY_SPOT_DISTANCE), 0, false)
      if (run(sim, 14).some((e) => e.type === 'goal')) goals++
    }
    expect(goals).toBeGreaterThan(22)
    expect(goals).toBeLessThan(39)
  })
})

describe('throw-ins and goal kicks', () => {
  test('a throw-in is thrown from above the head to a teammate who comes to offer', () => {
    const sim = newMatch(CFG)
    awardRestart(sim, Restart.ThrowIn, 0, 5, HALF_WIDTH)
    const offering = sim.teams[0].filter((e) => sim.c.SetPiece.active[e])
    expect(offering).toHaveLength(2)
    let thrown: SimEvent | undefined
    for (let i = 0; i < 12 * TICK_RATE && !thrown; i++) {
      step(sim)
      thrown = sim.m.events.find((e) => e.type === 'kick')
      if (thrown) expect(sim.c.Air.z[sim.ball]).toBeGreaterThan(1.5)
    }
    expect(thrown).toMatchObject({ kind: 'throw-in' })
  })

  test('opponents leave the box for a goal kick', () => {
    const sim = newMatch(CFG)
    const own = -attackDir(sim, 1) * HALF_LENGTH
    const striker = sim.teams[0].find((e) => roleOf(sim, e) === 'ST')!
    sim.c.Pos.x[striker] = own * 0.9
    sim.c.Pos.y[striker] = 0
    awardRestart(sim, Restart.GoalKick, 1, own * 0.9, 5)
    expect(sim.c.SetPiece.active[striker]).toBe(1)
    expect(Math.abs(sim.c.SetPiece.x[striker])).toBeLessThan(HALF_LENGTH - PENALTY_AREA_DEPTH)
  })
})

describe('review regressions', () => {
  test('a corner is not taken until the players going up have got there', () => {
    const sim = newMatch(CFG)
    const dir = attackDir(sim, 0)
    awardRestart(sim, Restart.Corner, 0, dir * HALF_LENGTH, HALF_WIDTH)
    const assigned = sim.players.filter((e) => sim.c.SetPiece.active[e])
    const spots = assigned.map((e) => spot(sim, e))
    const awarded = sim.m.tick
    let kicked = false
    let worst = 0
    for (let i = 0; i < 20 * TICK_RATE && !kicked; i++) {
      step(sim)
      kicked = sim.m.events.some((e) => e.type === 'kick')
      if (kicked) assigned.forEach((e, k) => (worst = Math.max(worst, Math.hypot(sim.c.Pos.x[e] - spots[k][0], sim.c.Pos.y[e] - spots[k][1]))))
    }
    expect(kicked).toBe(true)
    // Either everyone made it, or the wait ran out.
    expect(worst < 3 || sim.m.tick - awarded >= 10 * TICK_RATE).toBe(true)
  })

  test('a central direct free kick 20 m out is a shot', () => {
    const sim = newMatch(CFG)
    const dir = attackDir(sim, 0)
    awardFreeKick(sim, Restart.FreeKick, 0, dir * (HALF_LENGTH - 20), 2, false)
    const kick = run(sim, 16).find((e) => e.type === 'kick')
    expect(kick).toMatchObject({ kind: 'shot' })
  })

  test('at a penalty nobody else is inside the arc', () => {
    const sim = newMatch(CFG)
    const dir = attackDir(sim, 0)
    const spotX = dir * (HALF_LENGTH - PENALTY_SPOT_DISTANCE)
    awardFreeKick(sim, Restart.Penalty, 0, spotX, 0, false)
    for (const e of sim.players) {
      if (e === sim.m.restart.taker || e === keeperOf(sim, 1)) continue
      const [x, y] = spot(sim, e)
      expect(Math.hypot(x - spotX, y)).toBeGreaterThanOrEqual(CENTRE_CIRCLE_RADIUS)
    }
  })
})

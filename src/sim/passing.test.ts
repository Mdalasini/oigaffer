import { describe, expect, test } from 'bun:test'
import { integrateBall } from './ballmotion'
import { newMatch } from './match'
import { decideFirstTime } from './onball'
import { bestPass, launch, PassType } from './passing'
import { revealAll } from './perception'
import { attackDir, type Sim } from './sim'
import { Phase } from './state'
import { IntentKind, setIntent } from './intents'
import { updateScratch } from './brain'

const CFG = { seed: 4, halfMinutes: 45, formations: ['4-3-3', '3-4-3'] as [string, string] }

/** A match frozen in open play with everyone parked far away, so tests can place a few players. */
function emptyPitch(): Sim {
  const sim = newMatch(CFG)
  sim.m.phase = Phase.Play
  const { Pos, Vel } = sim.c
  sim.players.forEach((eid, i) => {
    Pos.x[eid] = -50 + i * 0.5
    Pos.y[eid] = 33
    Vel.x[eid] = 0
    Vel.y[eid] = 0
  })
  return sim
}

function place(sim: Sim, eid: number, x: number, y: number, vx = 0, vy = 0) {
  const { Pos, Vel } = sim.c
  Pos.x[eid] = x
  Pos.y[eid] = y
  Vel.x[eid] = vx
  Vel.y[eid] = vy
}

function landing(type: PassType, tx: number, ty: number): [number, number] {
  const [vx, vy, vz] = launch(type, 0, 0, tx, ty)
  const b = { x: 0, y: 0, z: 0, vx, vy, vz }
  for (let i = 0; i < 600; i++) {
    integrateBall(b)
    if (b.z === 0) return [b.x, b.y]
  }
  return [NaN, NaN]
}

describe('kick planning', () => {
  test('lofted passes and crosses come down where they were aimed', () => {
    for (const [type, x, y] of [
      [PassType.Lofted, 30, 10],
      [PassType.Lofted, 45, -5],
      [PassType.Cross, 20, -15],
    ] as const) {
      const [lx, ly] = landing(type, x, y)
      expect(Math.hypot(lx - x, ly - y)).toBeLessThan(1.2)
    }
  })

  test('ground passes stay on the ground', () => {
    expect(launch(PassType.Ground, 0, 0, 20, 0)[2]).toBe(0)
    expect(launch(PassType.Through, 0, 0, 20, 0)[2]).toBe(0)
  })
})

describe('choosing a pass', () => {
  test('a defender standing in the lane rules out the ground pass to feet', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    const [passer, mate] = [sim.teams[0][5], sim.teams[0][6]]
    const blocker = sim.teams[1][5]
    place(sim, passer, 0, 0)
    place(sim, sim.ball, 0.5 * dir, 0)
    place(sim, mate, 20 * dir, 0)
    revealAll(sim)
    const open = bestPass(sim, passer, 0.5 * dir, 0, mate, true)
    place(sim, blocker, 10 * dir, 0)
    revealAll(sim)
    const blocked = bestPass(sim, passer, 0.5 * dir, 0, mate, true)
    expect(open!.success).toBeGreaterThan(0.8)
    expect(blocked === null || blocked.success < 0.3).toBe(true)
  })

  test('a defender sprinting into the lane makes the pass risky even from a distance', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    const [passer, mate] = [sim.teams[0][5], sim.teams[0][6]]
    const defender = sim.teams[1][5]
    place(sim, passer, 0, 0)
    place(sim, sim.ball, 0.5 * dir, 0)
    place(sim, mate, 25 * dir, 0)
    place(sim, defender, 10 * dir, 6)
    revealAll(sim)
    const still = bestPass(sim, passer, 0.5 * dir, 0, mate, true)!
    place(sim, defender, 10 * dir, 6, 0, -8)
    revealAll(sim)
    const running = bestPass(sim, passer, 0.5 * dir, 0, mate, true)
    expect(running === null || running.success < still.success - 0.3).toBe(true)
  })

  test('a ball lofted to where a defender will be when it drops is judged a long shot', () => {
    // From a flagged moment: a chip across midfield to a team-mate with a
    // defender running to the same spot, chosen over a simple pass on the ground.
    const sim = emptyPitch()
    const [passer, mate] = [sim.teams[1][9], sim.teams[1][10]]
    const [back, presser, marker] = [1, 5, 6].map((i) => sim.teams[0][i])
    place(sim, passer, -13.5, 6.5, -2.8, -2)
    place(sim, sim.ball, -14.3, 5.9)
    place(sim, mate, -20.4, -12.8, -1.6, -0.1)
    place(sim, marker, -17.2, -9.7, -4.4, -0.1)
    place(sim, presser, -17.9, 6.9, 3.4, 1.6)
    place(sim, back, -30.4, -18, -4.2, 1.9)
    revealAll(sim)
    const plan = bestPass(sim, passer, -14.3, 5.9, mate)
    expect(plan === null || plan.type !== PassType.Lofted || plan.success < 0.5).toBe(true)
  })

  test('a ball lofted over a defender in the lane to a free team-mate is still on', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    const [passer, mate] = [sim.teams[0][5], sim.teams[0][6]]
    const blocker = sim.teams[1][5]
    place(sim, passer, 0, 0)
    place(sim, sim.ball, 0.5 * dir, 0)
    place(sim, mate, 25 * dir, 0)
    place(sim, blocker, 10 * dir, 0)
    revealAll(sim)
    const plan = bestPass(sim, passer, 0.5 * dir, 0, mate)
    expect(plan!.type).toBe(PassType.Lofted)
  })

  test('a winger running beyond a flat back line gets a through ball', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    const [passer, runner] = [sim.teams[0][6], sim.teams[0][8]]
    place(sim, passer, 0, 0)
    place(sim, sim.ball, 0.5 * dir, 0)
    // The runner is level with the defenders and sprinting past them.
    place(sim, runner, 25 * dir, -10, 7 * dir, 0)
    // A flat back four with a gap between the right-sided pair for the runner.
    ;[-24, 2, 10, 18].forEach((y, i) => place(sim, sim.teams[1][1 + i], 25 * dir, y))
    revealAll(sim)
    const plan = bestPass(sim, passer, 0.5 * dir, 0)
    expect(plan?.target).toBe(runner)
    expect(plan?.type).toBe(PassType.Through)
    expect(plan!.x * dir).toBeGreaterThan(28)
  })

  test('a wide player near the byline crosses to a striker in the box', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    const [winger, striker] = [sim.teams[0][8], sim.teams[0][9]]
    place(sim, winger, 40 * dir, -28)
    place(sim, sim.ball, 40.5 * dir, -28)
    place(sim, striker, 44 * dir, 0)
    place(sim, sim.teams[1][2], 44 * dir, -6)
    revealAll(sim)
    const plan = bestPass(sim, winger, 40.5 * dir, -28, striker)
    expect([PassType.Cross, PassType.DrivenCross, PassType.Lofted] as number[]).toContain(plan!.type)
  })
})

describe('first-time passes', () => {
  test('a player asked for a wall pass sets up a first-time return to the runner', () => {
    const sim = emptyPitch()
    const dir = attackDir(sim, 0)
    const [runner, wall] = [sim.teams[0][7], sim.teams[0][9]]
    place(sim, runner, 20 * dir, 5, 7 * dir, 0)
    place(sim, wall, 25 * dir, 0)
    // Ball arriving at the wall's feet.
    place(sim, sim.ball, 23 * dir, 0, 6 * dir, 0)
    sim.m.ball.owner = -1
    sim.m.ball.lastTeam = 0
    setIntent(sim, wall, IntentKind.Receive, runner)
    sim.c.Brain.wallFor[wall] = runner
    sim.c.Brain.wallUntil[wall] = sim.m.tick + 60
    revealAll(sim)
    updateScratch(sim)
    decideFirstTime(sim, wall)
    expect(sim.c.Plan.firstTime[wall]).toBe(1)
    expect(sim.c.Plan.target[wall]).toBe(runner)
  })
})

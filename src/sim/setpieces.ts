// Set pieces: where everyone goes for a corner, free kick, penalty, throw-in
// or goal kick, and how the taker takes it. Positions are assigned once when
// the restart is awarded and kept in the SetPiece store, so they snapshot.

import { integrateBall, type BallState } from './ballmotion'
import { kick } from './actions'
import { BALL_RADIUS, TICK_RATE } from './constants'
import { clamp, cos, sin, atan2 } from './fmath'
import { keeperOf } from './keeper'
import { bestPass, launch, PassType, strikePass, type PassPlan } from './passing'
import { CENTRE_CIRCLE_RADIUS, GOAL_AREA_DEPTH, GOAL_HEIGHT, GOAL_WIDTH, HALF_LENGTH, HALF_WIDTH, PENALTY_AREA_DEPTH, PENALTY_AREA_WIDTH, PENALTY_SPOT_DISTANCE } from './pitch'
import { chance, gauss, next, range } from './rng'
import { planShot, strikeShot } from './shooting'
import { attackDir, roleOf, teamOf, type Sim } from './sim'
import { Restart } from './state'

/** Longest the taker waits beyond the delay for everyone to reach their spot. */
export const MAX_SET_WAIT = 6 * TICK_RATE

/** Everyone with a set-piece spot is (nearly) on it. */
export function setPieceReady(sim: Sim): boolean {
  const { c } = sim
  for (const e of sim.players) {
    if (!c.SetPiece.active[e]) continue
    const dx = c.Pos.x[e] - c.SetPiece.x[e]
    const dy = c.Pos.y[e] - c.SetPiece.y[e]
    if (dx * dx + dy * dy > 2.5 * 2.5) return false
  }
  return true
}

/** How long players get to take up positions before the restart is taken. */
export function restartDelay(kind: Restart, x: number, sim: Sim, team: number): number {
  switch (kind) {
    case Restart.Corner:
    case Restart.Penalty:
      return 4 * TICK_RATE
    case Restart.FreeKick:
      return (HALF_LENGTH - x * attackDir(sim, team) < 35 ? 4 : 1.5) * TICK_RATE
    case Restart.GoalKick:
      return 3 * TICK_RATE
    default:
      return 1.5 * TICK_RATE
  }
}

/** Number of players in a free-kick wall at this distance from goal. */
function wallSize(dist: number): number {
  return dist < 20 ? 4 : dist < 25 ? 3 : dist < 32 ? 2 : 0
}

function set(sim: Sim, eid: number, ax: number, ay: number, dir: number) {
  const { SetPiece } = sim.c
  SetPiece.active[eid] = 1
  SetPiece.x[eid] = clamp(ax, -HALF_LENGTH + 0.5, HALF_LENGTH - 0.5) * dir
  SetPiece.y[eid] = clamp(ay, -HALF_WIDTH + 0.5, HALF_WIDTH - 0.5) * dir
}

/** Strongest first: who goes up for headers. */
function byStrength(sim: Sim, eids: number[]): number[] {
  return [...eids].sort((a, b) => sim.c.Attr.strength[b] - sim.c.Attr.strength[a] || a - b)
}

/** Assigns set-piece positions for the restart just awarded. Players left unassigned keep their shape. */
export function arrangeSetPiece(sim: Sim): void {
  const { m, c } = sim
  c.SetPiece.active.fill(0)
  const { kind, team, taker } = m.restart
  const dir = attackDir(sim, team)
  const bx = m.restart.x * dir
  const by = m.restart.y * dir
  const attackers = sim.teams[team].filter((e) => e !== taker && roleOf(sim, e) !== 'GK')
  const defenders = sim.teams[1 - team].filter((e) => roleOf(sim, e) !== 'GK')
  const gk = keeperOf(sim, 1 - team)
  const goalDist = Math.sqrt((HALF_LENGTH - bx) * (HALF_LENGTH - bx) + by * by)

  if (kind === Restart.Penalty) {
    // Everyone but taker and keeper outside the box and arc, behind the ball.
    // Outside the area and at least 9.15 m (the arc) from the spot, spread across the width.
    const spread = [...attackers, ...defenders]
    const spot = HALF_LENGTH - PENALTY_SPOT_DISTANCE
    spread.forEach((e, i) => {
      const x = HALF_LENGTH - PENALTY_AREA_DEPTH - 2 - (i % 3) * 2
      let y = -16 + i * 1.6
      const dx = spot - x
      const minY = Math.sqrt(Math.max(0, (CENTRE_CIRCLE_RADIUS + 1) * (CENTRE_CIRCLE_RADIUS + 1) - dx * dx))
      if (Math.abs(y) < minY) y = (y < 0 ? -1 : 1) * minY
      set(sim, e, x, y, dir)
    })
    set(sim, gk, HALF_LENGTH - 0.2, 0, dir)
    return
  }
  if (kind === Restart.Corner || (kind === Restart.FreeKick && !m.restart.indirect && goalDist < 35)) {
    const corner = kind === Restart.Corner
    const side = by >= 0 ? 1 : -1
    // Attack: the strongest go to the near post, far post, penalty spot and six-yard box.
    const box: [number, number][] = [
      [HALF_LENGTH - 3, side * 2.5],
      [HALF_LENGTH - 4, -side * 3.5],
      [HALF_LENGTH - 11, 0],
      [HALF_LENGTH - 6, 0],
      [HALF_LENGTH - 16, side * 6],
    ]
    const up = byStrength(sim, attackers)
    const goingUp = up.slice(0, corner ? box.length : 4)
    goingUp.forEach((e, i) => set(sim, e, box[i][0], box[i][1], dir))
    if (corner) {
      // A short option near the corner.
      const short = up[box.length]
      if (short !== undefined) set(sim, short, bx - 10, by - side * 6, dir)
    }
    // Defence: keeper on the line, the wall for a free kick, zonal six-yard line, the rest marking.
    set(sim, gk, HALF_LENGTH - 0.6, corner ? -side * 0.6 : clamp(by * 0.1, -1, 1), dir)
    let free = byStrength(sim, defenders)
    if (!corner) {
      const n = wallSize(goalDist)
      // Wall on the line from ball to the near post, 9.15 m out.
      const px = HALF_LENGTH
      const py = (by >= 0 ? 1 : -1) * Math.min(Math.abs(by), GOAL_WIDTH / 2 - 0.8)
      const wl = Math.sqrt((px - bx) * (px - bx) + (py - by) * (py - by)) || 1
      const ux = (px - bx) / wl
      const uy = (py - by) / wl
      const wx = bx + ux * CENTRE_CIRCLE_RADIUS
      const wy = by + uy * CENTRE_CIRCLE_RADIUS
      // Shoulder to shoulder across the line of the kick.
      free.slice(0, n).forEach((e, i) => set(sim, e, wx - uy * (i - (n - 1) / 2) * 0.7, wy + ux * (i - (n - 1) / 2) * 0.7, dir))
      free = free.slice(n)
    }
    const zones: [number, number][] = [
      [HALF_LENGTH - GOAL_AREA_DEPTH, -3],
      [HALF_LENGTH - GOAL_AREA_DEPTH, 0],
      [HALF_LENGTH - GOAL_AREA_DEPTH, 3],
      [HALF_LENGTH - 0.8, side * 3.2],
    ]
    free.slice(0, corner ? zones.length : 2).forEach((e, i) => set(sim, e, zones[i][0], zones[i][1], dir))
    free = free.slice(corner ? zones.length : 2)
    // Markers stand goal side of each attacker who went up.
    goingUp.forEach((a, i) => {
      const e = free[i]
      if (e === undefined) return
      set(sim, e, c.SetPiece.x[a] * dir + 1, c.SetPiece.y[a] * dir, dir)
    })
    return
  }
  if (kind === Restart.ThrowIn) {
    // Two nearest teammates come to offer for the throw; their markers follow.
    const near = [...attackers].sort((a, b) => dist(sim, a, m.restart.x, m.restart.y) - dist(sim, b, m.restart.x, m.restart.y) || a - b).slice(0, 2)
    const inward = by > 0 ? -1 : 1
    near.forEach((e, i) => set(sim, e, bx + (i === 0 ? 6 : -5), by + inward * (5 + i * 4), dir))
    return
  }
  if (kind === Restart.GoalKick) {
    // Opponents out of the box while the goal kick is taken.
    for (const e of defenders) {
      const ax = c.Pos.x[e] * attackDir(sim, 1 - team)
      const ay = c.Pos.y[e] * attackDir(sim, 1 - team)
      // In the defending team's frame the box is at the far end.
      if (ax > HALF_LENGTH - PENALTY_AREA_DEPTH - 1 && Math.abs(ay) < PENALTY_AREA_WIDTH / 2 + 1) {
        const d2 = attackDir(sim, 1 - team)
        c.SetPiece.active[e] = 1
        c.SetPiece.x[e] = (HALF_LENGTH - PENALTY_AREA_DEPTH - 3) * d2
        c.SetPiece.y[e] = c.Pos.y[e]
      }
    }
  }
}

function dist(sim: Sim, e: number, x: number, y: number): number {
  return Math.sqrt((sim.c.Pos.x[e] - x) * (sim.c.Pos.x[e] - x) + (sim.c.Pos.y[e] - y) * (sim.c.Pos.y[e] - y))
}

/** The taker takes the restart. Called once, when it is time. */
export function takeSetPiece(sim: Sim): void {
  const { m, c, ball } = sim
  const { kind, taker, indirect } = m.restart
  const team = teamOf(sim, taker)
  const bx = c.Pos.x[ball]
  const by = c.Pos.y[ball]
  c.SetPiece.active.fill(0)
  switch (kind) {
    case Restart.Penalty:
      return penalty(sim, taker)
    case Restart.ThrowIn:
      return throwIn(sim, taker)
    case Restart.Corner:
      return cross(sim, taker, true)
    case Restart.FreeKick: {
      const goalDist = Math.sqrt((targetX(sim, team) - bx) * (targetX(sim, team) - bx) + by * by)
      // In range and central enough, a direct free kick is a shot over or round the wall.
      if (!indirect && goalDist < 28 && Math.abs(by) < 16) return freeKickShot(sim, taker)
      if (!indirect && goalDist < 35) return cross(sim, taker, false)
      break
    }
  }
  const pass = bestPass(sim, taker, bx, by)
  if (pass) strikePass(sim, taker, pass, { firstTime: false, pressure: Infinity })
}

function targetX(sim: Sim, team: number): number {
  return attackDir(sim, team) * HALF_LENGTH
}

/** A corner or a wide free kick: a cross to the least marked man in the box, or played short. */
function cross(sim: Sim, taker: number, corner: boolean) {
  const { c, m } = sim
  const team = teamOf(sim, taker)
  const dir = attackDir(sim, team)
  const targets = sim.teams[team].filter((e) => e !== taker && c.Pos.x[e] * dir > HALF_LENGTH - PENALTY_AREA_DEPTH)
  if (corner && chance(m.rng, 0.15)) {
    const pass = bestPass(sim, taker, c.Pos.x[sim.ball], c.Pos.y[sim.ball])
    if (pass) return strikePass(sim, taker, pass, { firstTime: false, pressure: Infinity })
  }
  let best = -1
  let bestSpace = -1
  for (const t of targets) {
    let space = Infinity
    for (const o of sim.teams[1 - team]) space = Math.min(space, dist(sim, o, c.Pos.x[t], c.Pos.y[t]))
    space += next(m.rng) * 1.5
    if (space > bestSpace) {
      best = t
      bestSpace = space
    }
  }
  if (best < 0) {
    const pass = bestPass(sim, taker, c.Pos.x[sim.ball], c.Pos.y[sim.ball])
    if (pass) strikePass(sim, taker, pass, { firstTime: false, pressure: Infinity })
    return
  }
  const plan: PassPlan = { type: PassType.Cross, target: best, x: c.Pos.x[best], y: c.Pos.y[best], score: 0, success: 0 }
  strikePass(sim, taker, plan, { firstTime: false, pressure: Infinity })
}

/**
 * A direct free kick: over the wall and under the bar if the flight allows,
 * otherwise round the wall into the far corner.
 */
function freeKickShot(sim: Sim, taker: number) {
  const { c, m } = sim
  const team = teamOf(sim, taker)
  const gx = targetX(sim, team)
  const bx = c.Pos.x[sim.ball]
  const by = c.Pos.y[sim.ball]
  const far = by >= 0 ? -1 : 1
  const aimY = far * (GOAL_WIDTH / 2 - 0.6)
  const dx = gx - bx
  const dy = aimY - by
  const d = Math.sqrt(dx * dx + dy * dy)
  const speed = 20 + 5 * c.Attr.shooting[taker]
  const vz = overTheWall(d, speed)
  const sigma = (0.03 + 0.05 * (1 - c.Attr.shooting[taker])) * (1 + d / 40)
  const a = atan2(dy, dx) + gauss(m.rng) * sigma
  const v = speed * (1 + gauss(m.rng) * 0.03)
  kick(sim, taker, cos(a) * v, sin(a) * v, vz + gauss(m.rng) * sigma * 6, 'shot')
}

/** Vertical launch speed that clears a 2.4 m wall 9.15 m out and dips to about 2 m at `d`. */
function overTheWall(d: number, speed: number): number {
  let best = 0
  let bestErr = Infinity
  for (let vz = 2; vz <= 9; vz += 0.25) {
    const b: BallState = { x: 0, y: 0, z: 0, vx: speed, vy: 0, vz }
    let atWall = 0
    let atGoal = 0
    for (let i = 0; i < 200 && b.x < d; i++) {
      integrateBall(b)
      if (atWall === 0 && b.x >= CENTRE_CIRCLE_RADIUS) atWall = b.z
      atGoal = b.z
    }
    if (atWall < 2.4) continue
    const err = Math.abs(atGoal - (GOAL_HEIGHT - BALL_RADIUS - 0.4))
    if (err < bestErr) {
      best = vz
      bestErr = err
    }
  }
  return best
}

/** The keeper guesses a side; the taker places it in a corner with some error. */
function penalty(sim: Sim, taker: number) {
  const { c, m } = sim
  const team = teamOf(sim, taker)
  const gk = keeperOf(sim, 1 - team)
  const plan = planShot(sim, taker, c.Pos.x[sim.ball], c.Pos.y[sim.ball])
  // Penalty takers pick a side rather than reading the keeper.
  plan.y = (chance(m.rng, 0.5) ? 1 : -1) * (GOAL_WIDTH / 2 - range(m.rng, 0.3, 1.0))
  plan.z = range(m.rng, 0.3, 1.6)
  // A placed, unhurried kick: half the usual error.
  strikeShot(sim, taker, plan, false, 0.5)
  const guess = next(m.rng)
  c.Keeper.diveAt[gk] = m.tick
  c.Keeper.x[gk] = c.Pos.x[gk]
  // A guess made before the kick rarely reaches right into the corner.
  c.Keeper.y[gk] = guess < 0.42 ? 1.9 : guess < 0.84 ? -1.9 : 0
}

/** A throw: both feet on the line, ball released from above the head to a nearby teammate. */
function throwIn(sim: Sim, taker: number) {
  const { c } = sim
  const bx = c.Pos.x[sim.ball]
  const by = c.Pos.y[sim.ball]
  const pass = bestPass(sim, taker, bx, by, -1, true)
  let tx = bx
  let ty = by * 0.8
  if (pass && Math.sqrt((pass.x - bx) * (pass.x - bx) + (pass.y - by) * (pass.y - by)) < 25) {
    tx = pass.x
    ty = pass.y
  }
  const dx = tx - bx
  const dy = ty - by
  const d = Math.sqrt(dx * dx + dy * dy) || 1
  const [vx, vy] = launch(PassType.Ground, bx, by, tx, ty)
  const h = Math.min(14, Math.sqrt(vx * vx + vy * vy))
  c.Air.z[sim.ball] = 2
  kick(sim, taker, (dx / d) * h, (dy / d) * h, 2.5, 'throw-in', pass ? pass.target : -1)
}

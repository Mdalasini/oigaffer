// Off-ball movement. With the ball: runs in behind timed to stay onside,
// coming short when tightly marked, and stepping out of a blocked passing
// lane. Without it: a second man cutting off the carrier's easiest pass,
// zonal marking goal side, a level back line, and covering for a teammate
// who has been pulled out of position.

import { TICK_RATE } from './constants'
import { clamp, hypot } from './fmath'
import { IntentKind, setIntent } from './intents'
import { believe, type Belief } from './perception'
import { HALF_LENGTH, HALF_WIDTH } from './pitch'
import type { Role } from './formation'
import { chance } from './rng'
import { shapeTarget, type Point } from './shape'
import { attackDir, roleOf, teamOf, type Sim } from './sim'
import { nearestOpponent } from './evaluate'

const seen: Belief = { x: 0, y: 0, vx: 0, vy: 0 }
const near: Belief = { x: 0, y: 0, vx: 0, vy: 0 }
const RUNNERS: Role[] = ['ST', 'W', 'WB', 'FB', 'CM']
const BACK_LINE: Role[] = ['CB', 'FB', 'WB']
/** A slot this far from its player counts as vacated. */
const VACATED = 12

/**
 * How far up the pitch (attacking-frame x) the observer can stand without
 * being offside: level with the second-last opponent, or the ball if it is
 * further forward, and never short of halfway.
 */
export function onsideLimit(sim: Sim, observer: number): number {
  const team = teamOf(sim, observer)
  const dir = attackDir(sim, team)
  let last = -Infinity
  let second = -Infinity
  for (const o of sim.teams[1 - team]) {
    believe(sim, observer, o, seen)
    const ax = seen.x * dir
    if (ax > last) {
      second = last
      last = ax
    } else if (ax > second) second = ax
  }
  believe(sim, observer, sim.ball, seen)
  return Math.max(second, seen.x * dir, 0)
}

/** Off-ball decisions for a player whose team has the ball: make a run, or hold position. */
export function decideSupport(sim: Sim, eid: number, carrier: number): void {
  const { c, m } = sim
  if (roleOf(sim, eid) === 'GK') return setIntent(sim, eid, IntentKind.Hold)
  const team = teamOf(sim, eid)
  const dir = attackDir(sim, team)
  const x = c.Pos.x[eid]
  const y = c.Pos.y[eid]
  believe(sim, eid, carrier, seen)
  const cx = seen.x
  const cy = seen.y
  const toCarrier = Math.sqrt((cx - x) * (cx - x) + (cy - y) * (cy - y))
  const ready = m.tick >= c.Brain.runReady[eid]

  // In behind: from level with the line, when the carrier has time and space to pick it out.
  const line = onsideLimit(sim, eid)
  const ax = x * dir
  const carrierFree = nearestOpponent(sim, eid, cx, cy, near) < 0 || hypot(near.x - cx, near.y - cy) > 3
  if (
    ready &&
    RUNNERS.includes(roleOf(sim, eid)) &&
    carrierFree &&
    ax > line - 6 &&
    ax <= line + 0.5 &&
    line < HALF_LENGTH - 14 &&
    ax > cx * dir &&
    chance(m.rng, 0.15 + 0.25 * c.Attr.positioning[eid])
  ) {
    const tx = dir * Math.min(line + 14, HALF_LENGTH - 6)
    const ty = clamp(y * 0.85, -HALF_WIDTH + 3, HALF_WIDTH - 3)
    c.Brain.runReady[eid] = m.tick + 5 * TICK_RATE
    return setIntent(sim, eid, IntentKind.Run, -1, tx, ty)
  }

  // Coming short: shake off a tight marker standing goal side by dropping towards the ball.
  const marked = nearestOpponent(sim, eid, x, y, near) >= 0 && (near.x - x) * dir > 0.5
  const marker = marked ? hypot(near.x - x, near.y - y) : Infinity
  if (ready && marker < 2.5 && toCarrier > 12 && toCarrier < 35 && ax > cx * dir) {
    const k = 9 / toCarrier
    const tx = cx + (x - cx) * k
    const ty = cy + (y - cy) * k
    c.Brain.runReady[eid] = m.tick + 3 * TICK_RATE
    return setIntent(sim, eid, IntentKind.Run, -1, tx, ty)
  }
  setIntent(sim, eid, IntentKind.Hold)
}

/** Where a player holding position should stand during open play. */
export function openPlayTarget(sim: Sim, eid: number, out: Point): Point {
  shapeTarget(sim, eid, out)
  if (roleOf(sim, eid) === 'GK') return out
  const team = teamOf(sim, eid)
  const owner = sim.m.ball.owner
  if (sim.m.possession === team) {
    if (owner >= 0 && owner !== eid && teamOf(sim, owner) === team) openLane(sim, eid, owner, out)
    // Hold the line: never drift offside while waiting.
    const dir = attackDir(sim, team)
    const limit = onsideLimit(sim, eid) - 0.5
    if (out.x * dir > limit) out.x = limit * dir
    return out
  }
  const cover = sim.scratch.cover[eid]
  if (cover >= 0) {
    // Fill the vacated slot instead of our own.
    shapeTarget(sim, cover, out)
    return out
  }
  const dir = attackDir(sim, team)
  // Furthest up the pitch (attacking-frame x) this player may stand and still be goal side of their man.
  const limit = markZone(sim, eid, out)
  // The back line holds one height, but drops rather than leave its man behind it.
  if (BACK_LINE.includes(roleOf(sim, eid))) out.x = Math.min(sim.scratch.lineX[team], limit) * dir
  return out
}

/** Step sideways out of a passing lane an opponent is standing in. */
function openLane(sim: Sim, eid: number, carrier: number, out: Point) {
  believe(sim, eid, carrier, seen)
  const dx = out.x - seen.x
  const dy = out.y - seen.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 6 || len > 35) return
  for (const o of sim.teams[1 - teamOf(sim, eid)]) {
    believe(sim, eid, o, near)
    const t = clamp(((near.x - seen.x) * dx + (near.y - seen.y) * dy) / (len * len), 0, 1)
    const px = seen.x + dx * t - near.x
    const py = seen.y + dy * t - near.y
    if (t > 0.15 && t < 0.95 && px * px + py * py < 2 * 2) {
      // Move off the line on the side away from the blocker.
      // (-dy, dx) is the lane's left; step to the side the blocker is not on.
      const side = (near.x - seen.x) * dy - (near.y - seen.y) * dx > 0 ? 1 : -1
      out.x = clamp(out.x + (-dy / len) * side * 4, -HALF_LENGTH + 2, HALF_LENGTH - 2)
      out.y = clamp(out.y + (dx / len) * side * 4, -HALF_WIDTH + 1.5, HALF_WIDTH - 1.5)
      return
    }
  }
}

/**
 * Zonal marking: pick up the nearest attacker in our zone, a little goal
 * side of them; near our own goal, tight to them. Returns the
 * attacking-frame x the marker must stay behind (Infinity if marking nobody).
 */
function markZone(sim: Sim, eid: number, out: Point): number {
  const team = teamOf(sim, eid)
  const dir = attackDir(sim, team)
  let best = -1
  let bestD = 10 * 10
  for (const o of sim.teams[1 - team]) {
    if (roleOf(sim, o) === 'GK') continue
    believe(sim, eid, o, near)
    const d = (near.x - out.x) * (near.x - out.x) + (near.y - out.y) * (near.y - out.y)
    if (d < bestD) {
      best = o
      bestD = d
      seen.x = near.x
      seen.y = near.y
    }
  }
  if (best < 0) return Infinity
  const ownGoal = -dir * HALF_LENGTH
  const danger = hypot(seen.x - ownGoal, seen.y) < 28
  if (!danger && bestD > 8 * 8) return Infinity
  // Goal side, on the line between the attacker and the middle of our goal.
  const gl = hypot(ownGoal - seen.x, -seen.y) || 1
  const gap = danger ? 1 : 1.5
  const gx = seen.x + ((ownGoal - seen.x) / gl) * gap
  const gy = seen.y + (-seen.y / gl) * gap
  const w = danger ? 0.9 : 0.6
  out.x = out.x * (1 - w) + gx * w
  out.y = out.y * (1 - w) + gy * w
  // However the zone pulls, never end up on the wrong side of the man.
  if ((out.x - gx) * dir > 0) out.x = gx
  // Near goal the marker's own spot is the limit: the line marks rather than holds.
  return danger ? out.x * dir : gx * dir
}

/** The second man out of possession: stand in the lane to the carrier's nearest teammate. */
export function cutLane(sim: Sim, eid: number, top: number): void {
  const { c } = sim
  const option = c.Intent.target[eid]
  const carrier = sim.m.ball.owner
  if (carrier < 0) return setIntent(sim, eid, IntentKind.Hold)
  believe(sim, eid, option, near)
  believe(sim, eid, carrier, seen)
  // A third of the way from the option back towards the ball.
  const tx = near.x + (seen.x - near.x) * 0.3
  const ty = near.y + (seen.y - near.y) * 0.3
  c.Motor.tx[eid] = tx
  c.Motor.ty[eid] = ty
  c.Motor.speed[eid] = top * 0.85
}

/**
 * Team-level shape facts, rebuilt each tick: each side's back-line height,
 * who covers which vacated slot, and who cuts off the carrier's easiest pass.
 */
export function updateTeamShape(sim: Sim): void {
  const { scratch, c, m } = sim
  scratch.cover.fill(-1)
  const p: Point = { x: 0, y: 0 }
  for (const team of [0, 1]) {
    const dir = attackDir(sim, team)
    // The back line steps up and drops together, at its members' average height.
    let sum = 0
    let n = 0
    for (const e of sim.teams[team]) {
      if (!BACK_LINE.includes(roleOf(sim, e))) continue
      shapeTarget(sim, e, p)
      sum += p.x * dir
      n++
    }
    scratch.lineX[team] = n ? sum / n : 0
    scratch.laneCutter[team] = -1
    scratch.laneOption[team] = -1
    // Cover holds while out of possession, a loose ball included; lane cutting needs a carrier.
    if (m.possession === team) continue
    // Cover: a slot whose player has been pulled away is filled by the nearest teammate holding shape.
    for (const e of sim.teams[team]) {
      const role = roleOf(sim, e)
      if (role === 'GK' || role === 'W' || role === 'ST') continue
      shapeTarget(sim, e, p)
      const off = hypot(c.Pos.x[e] - p.x, c.Pos.y[e] - p.y)
      if (off < VACATED || c.Intent.kind[e] === IntentKind.Hold) continue
      let best = -1
      let bestD = 15 * 15
      for (const mate of sim.teams[team]) {
        if (mate === e || scratch.cover[mate] >= 0 || roleOf(sim, mate) === 'GK' || c.Intent.kind[mate] !== IntentKind.Hold) continue
        const d = (c.Pos.x[mate] - p.x) * (c.Pos.x[mate] - p.x) + (c.Pos.y[mate] - p.y) * (c.Pos.y[mate] - p.y)
        if (d < bestD) {
          best = mate
          bestD = d
        }
      }
      if (best >= 0) scratch.cover[best] = e
    }
    // Second man: the nearest free teammate to the carrier's nearest option cuts that lane.
    const carrier = m.ball.owner
    if (carrier < 0) continue
    let option = -1
    let optionD = 25 * 25
    for (const o of sim.teams[1 - team]) {
      if (o === carrier || roleOf(sim, o) === 'GK') continue
      const d = (c.Pos.x[o] - c.Pos.x[carrier]) * (c.Pos.x[o] - c.Pos.x[carrier]) + (c.Pos.y[o] - c.Pos.y[carrier]) * (c.Pos.y[o] - c.Pos.y[carrier])
      if (d < optionD) {
        option = o
        optionD = d
      }
    }
    if (option < 0) continue
    let cutter = -1
    let cutterD = 15 * 15
    for (const e of sim.teams[team]) {
      if (e === scratch.presser[team] || roleOf(sim, e) === 'GK' || scratch.cover[e] >= 0) continue
      const d = (c.Pos.x[e] - c.Pos.x[option]) * (c.Pos.x[e] - c.Pos.x[option]) + (c.Pos.y[e] - c.Pos.y[option]) * (c.Pos.y[e] - c.Pos.y[option])
      if (d < cutterD) {
        cutter = e
        cutterD = d
      }
    }
    scratch.laneCutter[team] = cutter
    scratch.laneOption[team] = option
  }
}

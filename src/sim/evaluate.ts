// Shared judgements players make about the pitch: how valuable a spot is,
// and whether a ball travelling along a flight can be reached in time.

import { DT, FOOT_REACH } from './constants'
import { clamp } from './fmath'
import { FLIGHT_STRIDE, type Flight } from './kicks'
import { acceleration, BRAKING, runTime, topSpeed } from './movement'
import { believe, type Belief } from './perception'
import { HALF_LENGTH, PENALTY_AREA_DEPTH, PENALTY_AREA_WIDTH } from './pitch'
import { attackDir, type Sim } from './sim'

/**
 * Roughly the chance that `team` having the ball at (x, y) leads to a goal:
 * ~0.2 at the penalty spot, ~0.1 at 25 m, next to nothing in their own half.
 * Same units as a shot's xG, so passes, carries and shots compare directly.
 */
export function pitchValue(sim: Sim, team: number, x: number, y: number): number {
  const ax = x * attackDir(sim, team)
  const gx = HALF_LENGTH - ax
  const v = clamp(1 - Math.sqrt(gx * gx + y * y) / 75, 0, 1)
  // Capped: right in front of goal everyone converges, so just being there is worth no more than a good chance.
  return Math.min(0.22, 0.35 * v * v * v)
}

/** What `team` stands to lose by giving the ball away at (x, y). */
export function lossValue(sim: Sim, team: number, x: number, y: number): number {
  return 0.01 + pitchValue(sim, 1 - team, x, y)
}

export function inAttackingBox(sim: Sim, team: number, x: number, y: number): boolean {
  const ax = x * attackDir(sim, team)
  return ax > HALF_LENGTH - PENALTY_AREA_DEPTH && Math.abs(y) < PENALTY_AREA_WIDTH / 2
}

/** Seconds an opponent takes to react before moving for a ball. */
const REACTION = 0.25
/** Highest a ball can be and still be cut out (a stretching foot or a jumping head). */
const REACH_HEIGHT = 2.1
const seen: Belief = { x: 0, y: 0, vx: 0, vy: 0 }
const near: Belief = { x: 0, y: 0, vx: 0, vy: 0 }

/** Seconds for someone at (x, y) to get a foot to (px, py), from a standing start after `reaction`. */
function reachTime(
  px: number,
  py: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  vmax: number,
  acc: number,
  reaction: number,
): number {
  const dx = px - x
  const dy = py - y
  const d = Math.sqrt(dx * dx + dy * dy)
  const reach = d - FOOT_REACH
  // Someone already at the ball's line only has to put a foot out.
  if (reach <= 0.3) return 0
  // Momentum towards the point helps; running the other way means braking first.
  const along = d > 0 ? (vx * dx + vy * dy) / d : 0
  const turn = along < 0 ? -along / BRAKING : 0
  return reaction + turn + runTime(reach, Math.max(0, along), vmax, acc)
}

/**
 * How likely `observer` thinks it is that one of `defenders` wins the ball on
 * its flight before sample `until`: they must get to a point on it before the
 * ball does and before the receiver could. 0 = nobody close, 1 = cut out.
 */
export function interceptRisk(
  sim: Sim,
  observer: number,
  defenders: number[],
  f: Flight,
  until: number,
  receiver: number,
  rx: number,
  ry: number,
  rvx: number,
  rvy: number,
): number {
  let risk = 0
  const last = Math.min(until, f.count - 1)
  const rmax = topSpeed(sim, receiver)
  const racc = acceleration(sim, receiver)
  for (const d of defenders) {
    believe(sim, observer, d, seen)
    const vmax = topSpeed(sim, d)
    const acc = acceleration(sim, d)
    for (let s = 1; s <= last; s++) {
      if (f.xyz[s * 3 + 2] > REACH_HEIGHT) continue
      const px = f.xyz[s * 3]
      const py = f.xyz[s * 3 + 1]
      const tOpp = reachTime(px, py, seen.x, seen.y, seen.vx, seen.vy, vmax, acc, REACTION)
      const tBall = s * FLIGHT_STRIDE * DT
      // The receiver knows the pass is coming, so reacts sooner.
      const tMate = reachTime(px, py, rx, ry, rvx, rvy, rmax, racc, 0.15)
      const r = clamp(0.5 + (tBall - tOpp) / 0.6, 0, 1) * clamp(0.5 + (tMate - tOpp) / 0.6, 0, 1)
      if (r > risk) {
        risk = r
        if (risk === 1) return 1
      }
    }
  }
  return risk
}

/**
 * First sample of a flight within `radius` of (x, y) and low enough to play,
 * or -1. The radius widens by half the distance between samples so a fast
 * ball cannot skip past the spot between two of them.
 */
export function arrivalSample(f: Flight, x: number, y: number, radius: number, maxHeight: number): number {
  for (let s = 1; s < f.count; s++) {
    const o = s * 3
    const dx = f.xyz[o] - x
    const dy = f.xyz[o + 1] - y
    const sx = f.xyz[o] - f.xyz[o - 3]
    const sy = f.xyz[o + 1] - f.xyz[o - 2]
    const r = radius + 0.5 * Math.sqrt(sx * sx + sy * sy)
    if (dx * dx + dy * dy <= r * r && f.xyz[o + 2] <= maxHeight) return s
  }
  return -1
}

export function dist2(sim: Sim, a: number, b: number): number {
  const { Pos } = sim.c
  const dx = Pos.x[a] - Pos.x[b]
  const dy = Pos.y[a] - Pos.y[b]
  return dx * dx + dy * dy
}

/** Distance from (x, y) to the nearest opponent the observer is aware of. */
export function pressureAt(sim: Sim, observer: number, x: number, y: number): number {
  return nearestOpponent(sim, observer, x, y, seen) < 0 ? Infinity : Math.sqrt((seen.x - x) * (seen.x - x) + (seen.y - y) * (seen.y - y))
}

/** Like `pressureAt`, but with each opponent carried on the way they are running for `ahead` seconds. */
export function pressureAhead(sim: Sim, observer: number, x: number, y: number, ahead: number): number {
  let best = Infinity
  for (const o of sim.teams[1 - sim.c.Player.team[observer]]) {
    believe(sim, observer, o, near)
    const dx = near.x + near.vx * ahead - x
    const dy = near.y + near.vy * ahead - y
    best = Math.min(best, Math.sqrt(dx * dx + dy * dy))
  }
  return best
}

/** The opponent the observer believes is nearest (x, y), with their believed state in `out`; -1 if none. */
export function nearestOpponent(sim: Sim, observer: number, x: number, y: number, out: Belief): number {
  let best = -1
  let bestD = Infinity
  for (const o of sim.teams[1 - sim.c.Player.team[observer]]) {
    believe(sim, observer, o, near)
    const d = (near.x - x) * (near.x - x) + (near.y - y) * (near.y - y)
    if (d < bestD) {
      best = o
      bestD = d
      out.x = near.x
      out.y = near.y
      out.vx = near.vx
      out.vy = near.vy
    }
  }
  return best
}

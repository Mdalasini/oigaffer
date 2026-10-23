// Choosing and striking passes along the ground.

import { kick } from './actions'
import { groundKickSpeed } from './ballmotion'
import { cos, sin, atan2, clamp } from './fmath'
import { gauss } from './rng'
import { attackDir, roleOf, teamOf, type Sim } from './sim'

export interface PassOption {
  target: number
  x: number
  y: number
  score: number
}

/** Distance from (px, py) to the segment (ax, ay)-(bx, by), and how far along it the closest point lies. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0
  const cx = ax + dx * t - px
  const cy = ay + dy * t - py
  return { dist: Math.sqrt(cx * cx + cy * cy), along: t * Math.sqrt(len2) }
}

/** Best ground pass for the player on the ball, or null if every lane is closed. */
export function bestGroundPass(sim: Sim, eid: number, minDist = 5, maxDist = 35): PassOption | null {
  const { Pos, Vel } = sim.c
  const team = teamOf(sim, eid)
  const dir = attackDir(sim, team)
  const bx = Pos.x[sim.ball]
  const by = Pos.y[sim.ball]
  let best: PassOption | null = null
  for (const t of sim.teams[team]) {
    if (t === eid) continue
    const rx = Pos.x[t] - bx
    const ry = Pos.y[t] - by
    const rough = Math.sqrt(rx * rx + ry * ry)
    if (rough < minDist || rough > maxDist) continue
    const lead = rough / 14
    const x = Pos.x[t] + Vel.x[t] * lead
    const y = Pos.y[t] + Vel.y[t] * lead
    const d = Math.sqrt((x - bx) * (x - bx) + (y - by) * (y - by))
    let blocked = false
    let space = Infinity
    for (const o of sim.teams[1 - team]) {
      const s = segmentDistance(Pos.x[o], Pos.y[o], bx, by, x, y)
      if (s.dist < 1.2 + 0.08 * s.along) blocked = true
      const r = Math.sqrt((Pos.x[o] - x) * (Pos.x[o] - x) + (Pos.y[o] - y) * (Pos.y[o] - y))
      if (r < space) space = r
    }
    if (blocked) continue
    const progress = ((x - bx) * dir) / 30
    const keeperPenalty = roleOf(sim, t) === 'GK' ? 0.4 : 0
    const score = 0.5 * progress + 0.4 * clamp(space / 6, 0, 1) - 0.01 * d - keeperPenalty
    if (!best || score > best.score) best = { target: t, x, y, score }
  }
  return best
}

/** Strikes a ground pass to arrive at (x, y) still rolling, with error that shrinks with passing skill. */
export function strikeGroundPass(sim: Sim, eid: number, target: number, x: number, y: number): void {
  const { Pos, Attr } = sim.c
  const bx = Pos.x[sim.ball]
  const by = Pos.y[sim.ball]
  const d = Math.sqrt((x - bx) * (x - bx) + (y - by) * (y - by))
  const speed = Math.min(28, groundKickSpeed(d, 3.5 + d * 0.08))
  const error = gauss(sim.m.rng) * 0.06 * (1.1 - Attr.passing[eid])
  const angle = atan2(y - by, x - bx) + error
  kick(sim, eid, cos(angle) * speed, sin(angle) * speed, 0, 'pass', target)
}

import { takeControl } from '../actions'
import { CONTROL_HEIGHT, FOOT_REACH, LOSE_DISTANCE } from '../constants'
import { nearestOpponent } from '../evaluate'
import type { Belief } from '../perception'
import { atan2, clamp, cos, sin } from '../fmath'
import { HALF_LENGTH } from '../pitch'
import { chance, gauss } from '../rng'
import { attackDir, teamOf, type Sim } from '../sim'
import { Phase } from '../state'
import { isGrounded } from '../defending'
import { canHandle, handle, inHandsReach, keeperOf } from '../keeper'
import { header, headerHeight } from '../shooting'

const opp: Belief = { x: 0, y: 0, vx: 0, vy: 0 }

/**
 * Decides who has the ball: owners lose a ball that strays, keepers take
 * what their hands reach, and loose balls go to whoever gets a foot or a
 * head to them first.
 */
export function possessionSystem(sim: Sim): void {
  const { m, c, ball } = sim
  if (m.phase !== Phase.Play || m.ball.inHands) return
  const bx = c.Pos.x[ball]
  const by = c.Pos.y[ball]
  const bz = c.Air.z[ball]
  const owner = m.ball.owner
  if (owner >= 0) {
    const dx = bx - c.Pos.x[owner]
    const dy = by - c.Pos.y[owner]
    const d2 = dx * dx + dy * dy
    if (d2 > LOSE_DISTANCE * LOSE_DISTANCE || bz > CONTROL_HEIGHT) m.ball.owner = -1
    // A keeper can smother a ball that is off the carrier's feet.
    else if (d2 > 0.6 * 0.6) {
      const gk = keeperOf(sim, 1 - teamOf(sim, owner))
      if (canHandle(sim, gk) && inHandsReach(sim, gk)) handle(sim, gk)
    }
    return
  }
  for (const team of [0, 1]) {
    const gk = keeperOf(sim, team)
    if (canHandle(sim, gk) && inHandsReach(sim, gk)) return handle(sim, gk)
  }
  let best = -1
  let bestD = Infinity
  for (const eid of sim.players) {
    if (m.tick < c.Brain.noTouchUntil[eid] || isGrounded(sim, eid)) continue
    if (c.Plan.type[eid] >= 0 && c.Plan.firstTime[eid]) {
      // Shaping to hit it first time: no trap while the ball is still coming; if it has gone past, take it.
      const approaching = (c.Pos.x[eid] - bx) * (c.Vel.x[ball] - c.Vel.x[eid]) + (c.Pos.y[eid] - by) * (c.Vel.y[ball] - c.Vel.y[eid]) > 0
      if (approaching) continue
      c.Plan.type[eid] = -1
    }
    const reach = bz <= CONTROL_HEIGHT ? FOOT_REACH : bz <= headerHeight(sim, eid) ? 0.6 : 0
    const dx = bx - c.Pos.x[eid]
    const dy = by - c.Pos.y[eid]
    const d2 = dx * dx + dy * dy
    if (d2 <= reach * reach && d2 < bestD) {
      best = eid
      bestD = d2
    }
  }
  if (best < 0) return
  if (bz > CONTROL_HEIGHT) header(sim, best)
  else firstTouch(sim, best)
}

/**
 * Controlling a ball gets harder the faster it arrives relative to the
 * player, the higher it is and the less they face it. A good touch is
 * directional: into space ahead, or away from pressure.
 */
function firstTouch(sim: Sim, eid: number) {
  const { c, m, ball } = sim
  const rvx = c.Vel.x[ball] - c.Vel.x[eid]
  const rvy = c.Vel.y[ball] - c.Vel.y[eid]
  const rel = Math.sqrt(rvx * rvx + rvy * rvy)
  const facing = rel > 0.5 ? (1 - cos(atan2(-rvy, -rvx) - c.Facing.a[eid])) / 2 : 0
  const heavy = clamp(
    0.03 + (rel - 8) / 16 + (c.Air.z[ball] > 0.4 ? 0.12 : 0) + facing * 0.15 - 0.3 * c.Attr.firstTouch[eid],
    0.01,
    0.7,
  )
  if (chance(m.rng, heavy)) {
    const a = atan2(rvy, rvx) + gauss(m.rng) * 0.9
    const speed = 1.5 + rel * 0.35
    return takeControl(sim, eid, false, cos(a) * speed, sin(a) * speed)
  }
  const dir = attackDir(sim, teamOf(sim, eid))
  const x = c.Pos.x[eid]
  const y = c.Pos.y[eid]
  let ux = dir * HALF_LENGTH - x
  let uy = -y * 0.3
  const ul = Math.sqrt(ux * ux + uy * uy) || 1
  ux /= ul
  uy /= ul
  // With someone close, take the touch away from them instead.
  if (nearestOpponent(sim, eid, x, y, opp) >= 0) {
    const ox = x - opp.x
    const oy = y - opp.y
    const d = Math.sqrt(ox * ox + oy * oy)
    if (d < 4 && d > 0) {
      const w = (4 - d) / 4
      ux = ux * (1 - w) + (ox / d) * w
      uy = uy * (1 - w) + (oy / d) * w
    }
  }
  const a = atan2(uy, ux)
  takeControl(sim, eid, true, cos(a) * 1.2, sin(a) * 1.2)
}

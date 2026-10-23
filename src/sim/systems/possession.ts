import { takeControl } from '../actions'
import { CONTROL_HEIGHT, FOOT_REACH, LOSE_DISTANCE } from '../constants'
import type { Sim } from '../sim'
import { Phase } from '../state'

/** Decides who has the ball: owners lose a ball that strays, and loose balls go to whoever reaches them. */
export function possessionSystem(sim: Sim): void {
  const { m, c, ball } = sim
  if (m.phase !== Phase.Play) return
  const bx = c.Pos.x[ball]
  const by = c.Pos.y[ball]
  const bz = c.Air.z[ball]
  const owner = m.ball.owner
  if (owner >= 0) {
    const dx = bx - c.Pos.x[owner]
    const dy = by - c.Pos.y[owner]
    if (dx * dx + dy * dy > LOSE_DISTANCE * LOSE_DISTANCE || bz > CONTROL_HEIGHT) m.ball.owner = -1
    return
  }
  if (bz > CONTROL_HEIGHT) return
  let best = -1
  let bestD = FOOT_REACH * FOOT_REACH
  for (const eid of sim.players) {
    if (m.tick < c.Brain.noTouchUntil[eid]) continue
    const dx = bx - c.Pos.x[eid]
    const dy = by - c.Pos.y[eid]
    const d2 = dx * dx + dy * dy
    if (d2 <= bestD) {
      best = eid
      bestD = d2
    }
  }
  if (best >= 0) takeControl(sim, best)
}

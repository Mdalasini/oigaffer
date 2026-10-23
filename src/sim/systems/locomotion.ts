import { query } from 'bitecs'
import { DT, PLAYER_RADIUS } from '../constants'
import { atan2, clamp, wrapAngle } from '../fmath'
import { acceleration, BRAKING } from '../movement'
import type { Sim } from '../sim'

/** Steers each player's velocity towards their motor target within accel/braking limits. */
export function locomotionSystem(sim: Sim): void {
  const { Pos, Vel, Motor, Facing, Attr } = sim.c
  for (const eid of query(sim.world, [Pos, Vel, Motor, Facing])) {
    const x = Pos.x[eid]
    const y = Pos.y[eid]
    const dx = Motor.tx[eid] - x
    const dy = Motor.ty[eid] - y
    const dist = Math.sqrt(dx * dx + dy * dy)
    // Arrive: never faster than what can still be braked to a stop at the target.
    const want = dist < 0.1 ? 0 : Math.min(Motor.speed[eid], Math.sqrt(2 * BRAKING * 0.8 * dist))
    const wx = dist > 0 ? (dx / dist) * want : 0
    const wy = dist > 0 ? (dy / dist) * want : 0
    let vx = Vel.x[eid]
    let vy = Vel.y[eid]
    const speed = Math.sqrt(vx * vx + vy * vy)
    const ddx = wx - vx
    const ddy = wy - vy
    const dv = Math.sqrt(ddx * ddx + ddy * ddy)
    const limit = (want < speed ? BRAKING : acceleration(sim, eid)) * DT
    if (dv > limit) {
      vx += (ddx / dv) * limit
      vy += (ddy / dv) * limit
    } else {
      vx = wx
      vy = wy
    }
    Vel.x[eid] = vx
    Vel.y[eid] = vy
    Pos.x[eid] = x + vx * DT
    Pos.y[eid] = y + vy * DT

    const moving = Math.sqrt(vx * vx + vy * vy)
    let face = Facing.a[eid]
    if (Motor.hasFace[eid]) face = atan2(Motor.faceY[eid] - y, Motor.faceX[eid] - x)
    else if (moving > 0.5) face = atan2(vy, vx)
    const turnRate = clamp(5 + 6 * Attr.agility[eid] - moving * 0.5, 2, 11)
    const turn = wrapAngle(face - Facing.a[eid])
    Facing.a[eid] = wrapAngle(Facing.a[eid] + clamp(turn, -turnRate * DT, turnRate * DT))
  }
}

/** Pushes overlapping players apart so nobody runs through anyone. */
export function separationSystem(sim: Sim): void {
  const { Pos } = sim.c
  const players = sim.players
  const min = PLAYER_RADIUS * 2
  for (let i = 0; i < players.length; i++) {
    const a = players[i]
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j]
      const dx = Pos.x[b] - Pos.x[a]
      const dy = Pos.y[b] - Pos.y[a]
      const d2 = dx * dx + dy * dy
      if (d2 >= min * min || d2 === 0) continue
      const d = Math.sqrt(d2)
      const push = (min - d) / 2 / d
      Pos.x[a] -= dx * push
      Pos.y[a] -= dy * push
      Pos.x[b] += dx * push
      Pos.y[b] += dy * push
    }
  }
}

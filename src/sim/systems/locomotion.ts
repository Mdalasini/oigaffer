import { query } from 'bitecs'
import { DT, PLAYER_RADIUS } from '../constants'
import { atan2, clamp, wrapAngle } from '../fmath'
import { DribbleMode } from '../dribble'
import { IntentKind } from '../intents'
import { acceleration, BRAKING } from '../movement'
import type { Sim } from '../sim'

/** Steers each player's velocity towards their motor target within accel/braking limits. */
export function locomotionSystem(sim: Sim): void {
  const { Pos, Vel, Motor, Facing, Attr } = sim.c
  for (const eid of query(sim.world, [Pos, Vel, Motor, Facing])) {
    const x = Pos.x[eid]
    const y = Pos.y[eid]
    let vx = Vel.x[eid]
    let vy = Vel.y[eid]
    const speed = Math.sqrt(vx * vx + vy * vy)
    let dx = Motor.tx[eid] - x
    let dy = Motor.ty[eid] - y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > 0) {
      // Aim off against sideways momentum, so a player cutting across to a
      // point gets there instead of circling it.
      const along = (vx * dx + vy * dy) / dist
      const lead = speed / (2 * BRAKING)
      dx -= (vx - (along * dx) / dist) * lead
      dy -= (vy - (along * dy) / dist) * lead
    }
    const aim = Math.sqrt(dx * dx + dy * dy)
    // Arrive: never faster than what can still be braked to a stop at the target.
    const want = dist < 0.1 ? 0 : Math.min(Motor.speed[eid], Math.sqrt(2 * BRAKING * 0.8 * dist))
    const wx = aim > 0 ? (dx / aim) * want : 0
    const wy = aim > 0 ? (dy / aim) * want : 0
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

/**
 * Pushes overlapping players apart so nobody runs through anyone. The
 * stronger player gives less ground, and a carrier shielding the ball is
 * braced for it: this is the physical jostling for position.
 */
export function separationSystem(sim: Sim): void {
  const { Pos, Attr, Intent } = sim.c
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
      const sa = (0.5 + Attr.strength[a]) * (braced(Intent.kind[a], Intent.mode[a]) ? 1.4 : 1)
      const sb = (0.5 + Attr.strength[b]) * (braced(Intent.kind[b], Intent.mode[b]) ? 1.4 : 1)
      const overlap = (min - d) / d
      const pa = (overlap * sb) / (sa + sb)
      const pb = (overlap * sa) / (sa + sb)
      Pos.x[a] -= dx * pa
      Pos.y[a] -= dy * pa
      Pos.x[b] += dx * pb
      Pos.y[b] += dy * pb
    }
  }
}

function braced(kind: number, mode: number): boolean {
  return kind === IntentKind.Carry && mode === DribbleMode.Shield
}

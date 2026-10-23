// Sense management. Players do not read the true world: each keeps a memory
// of where it last perceived every other entity. Memory refreshes for what is
// inside the player's field of view, for anything close enough to feel or
// hear, on periodic shoulder checks, and when a teammate shouts a warning.
// Decisions read the memory through `believe`, which extrapolates stale
// sightings a little.

import type { BallState } from './ballmotion'
import { MAX_ENTITIES } from './components'
import { DT, TICK_RATE } from './constants'
import { cos, sin } from './fmath'
import { emit, type CallKind } from './events'
import { teamOf, type Sim } from './sim'

/** cos(100°): the view cone is 200° wide. */
const VIEW_COS = -0.17364817766693033
/** Anything this close is sensed whichever way the player faces. */
export const AWARE_RADIUS = 3
/** Calls carry this far. */
export const HEARING_RADIUS = 30
/** Stale sightings are extrapolated along their velocity for at most this long. */
const MAX_EXTRAPOLATION = 1

const slot = (observer: number, target: number) => observer * MAX_ENTITIES + target

function remember(sim: Sim, observer: number, target: number) {
  const { Pos, Vel, Air, Memory } = sim.c
  const k = slot(observer, target)
  Memory.x[k] = Pos.x[target]
  Memory.y[k] = Pos.y[target]
  Memory.z[k] = Air.z[target]
  Memory.vx[k] = Vel.x[target]
  Memory.vy[k] = Vel.y[target]
  Memory.vz[k] = Air.vz[target]
  Memory.seen[k] = sim.m.tick
}

/** Seconds between shoulder checks, shorter for players with more vision. */
function scanInterval(sim: Sim, eid: number): number {
  return Math.round((3 - 2 * sim.c.Attr.vision[eid]) * TICK_RATE)
}

/** Everyone sees everything, e.g. when lining up for a kick-off. */
export function revealAll(sim: Sim): void {
  const targets = [sim.ball, ...sim.players]
  for (const o of sim.players) for (const t of targets) if (t !== o) remember(sim, o, t)
}

export function perceptionSystem(sim: Sim): void {
  const { Pos, Facing, Brain } = sim.c
  const tick = sim.m.tick
  const targets = [sim.ball, ...sim.players]
  for (const o of sim.players) {
    const scanning = tick >= Brain.nextScan[o]
    if (scanning) Brain.nextScan[o] = tick + scanInterval(sim, o)
    const fx = cos(Facing.a[o])
    const fy = sin(Facing.a[o])
    const ox = Pos.x[o]
    const oy = Pos.y[o]
    for (const t of targets) {
      if (t === o) continue
      const dx = Pos.x[t] - ox
      const dy = Pos.y[t] - oy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (scanning || d < AWARE_RADIUS || dx * fx + dy * fy >= VIEW_COS * d) remember(sim, o, t)
    }
  }
  warnCarrier(sim)
}

/**
 * "Man on!": a teammate who sees an opponent closing on the ball carrier that
 * the carrier has lost track of shouts, and the carrier now knows about them.
 */
function warnCarrier(sim: Sim) {
  const { Pos, Brain } = sim.c
  const carrier = sim.m.ball.owner
  if (carrier < 0 || sim.m.tick < Brain.warnedUntil[carrier]) return
  const team = teamOf(sim, carrier)
  for (const opp of sim.teams[1 - team]) {
    const dx = Pos.x[opp] - Pos.x[carrier]
    const dy = Pos.y[opp] - Pos.y[carrier]
    if (dx * dx + dy * dy > 6 * 6 || age(sim, carrier, opp) < 0.5) continue
    for (const mate of sim.teams[team]) {
      if (mate === carrier || sim.m.tick < Brain.nextCall[mate] || age(sim, mate, opp) > 0) continue
      const mx = Pos.x[mate] - Pos.x[carrier]
      const my = Pos.y[mate] - Pos.y[carrier]
      if (mx * mx + my * my > HEARING_RADIUS * HEARING_RADIUS) continue
      call(sim, mate, 'man-on', carrier, opp)
      Brain.warnedUntil[carrier] = sim.m.tick + 2 * TICK_RATE
      return
    }
  }
}

/** A shout from one player to a teammate about someone; the listener learns where they are. */
export function call(sim: Sim, by: number, kind: CallKind, to: number, about: number): void {
  sim.c.Brain.nextCall[by] = sim.m.tick + 2 * TICK_RATE
  emit(sim, { type: 'call', by, call: kind, to, about })
  if (about >= 0) remember(sim, to, about)
}

/** Seconds since the observer last perceived the target. */
export function age(sim: Sim, observer: number, target: number): number {
  return (sim.m.tick - sim.c.Memory.seen[slot(observer, target)]) * DT
}

export interface Belief {
  x: number
  y: number
  vx: number
  vy: number
}

/**
 * The ball's last sighted state, to predict its flight from. Unlike
 * `believe`, not extrapolated: callers run it through the ball integrator.
 */
export function lastSeenBall(sim: Sim, observer: number, out: BallState): BallState {
  const { Memory } = sim.c
  const k = slot(observer, sim.ball)
  out.x = Memory.x[k]
  out.y = Memory.y[k]
  out.z = Memory.z[k]
  out.vx = Memory.vx[k]
  out.vy = Memory.vy[k]
  out.vz = Memory.vz[k]
  return out
}

/** Where the observer believes the target is now. */
export function believe(sim: Sim, observer: number, target: number, out: Belief): Belief {
  const { Memory } = sim.c
  const k = slot(observer, target)
  const t = Math.min(age(sim, observer, target), MAX_EXTRAPOLATION)
  out.vx = Memory.vx[k]
  out.vy = Memory.vy[k]
  out.x = Memory.x[k] + out.vx * t
  out.y = Memory.y[k] + out.vy * t
  return out
}

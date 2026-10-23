// Primitive ball actions. Everything that changes who touched the ball goes
// through here so possession bookkeeping and events stay in one place.

import type { KickKind } from './events'
import { DT } from './constants'
import { IntentKind, setIntent } from './intents'
import type { Sim } from './sim'

/** Seconds after striking the ball before the same player can touch it again. */
const KICK_RECOVERY = 0.3

function recordTouch(sim: Sim, eid: number) {
  const { m, c } = sim
  m.ball.lastTouch = eid
  m.ball.lastTeam = c.Player.team[eid]
  m.ball.touchTick = m.tick
  m.possession = c.Player.team[eid]
  c.Brain.lastTouch[eid] = m.tick
}

/** Strikes the ball away from the player; the ball becomes loose. */
export function kick(sim: Sim, eid: number, vx: number, vy: number, vz: number, kind: KickKind, to = -1): void {
  const { c, m, ball } = sim
  c.Vel.x[ball] = vx
  c.Vel.y[ball] = vy
  c.Air.vz[ball] = vz
  m.ball.owner = -1
  recordTouch(sim, eid)
  c.Brain.noTouchUntil[eid] = m.tick + Math.round(KICK_RECOVERY / DT)
  m.events.push({ type: 'kick', tick: m.tick, by: eid, kind, to, x: c.Pos.x[ball], y: c.Pos.y[ball] })
  if (to >= 0) setIntent(sim, to, IntentKind.Receive, eid)
}

/** A dribbling touch: the carrier keeps the ball. */
export function touch(sim: Sim, eid: number, vx: number, vy: number): void {
  const { c, ball } = sim
  c.Vel.x[ball] = vx
  c.Vel.y[ball] = vy
  c.Air.z[ball] = 0
  c.Air.vz[ball] = 0
  recordTouch(sim, eid)
}

/** Brings a loose ball under control. */
export function takeControl(sim: Sim, eid: number): void {
  const { c, m, ball } = sim
  c.Vel.x[ball] = c.Vel.x[eid]
  c.Vel.y[ball] = c.Vel.y[eid]
  c.Air.z[ball] = 0
  c.Air.vz[ball] = 0
  m.ball.owner = eid
  recordTouch(sim, eid)
  m.events.push({ type: 'control', tick: m.tick, by: eid, x: c.Pos.x[ball], y: c.Pos.y[ball] })
}

/** Puts a dead ball on a spot. */
export function placeBall(sim: Sim, x: number, y: number): void {
  const { c, m, ball } = sim
  c.Pos.x[ball] = x
  c.Pos.y[ball] = y
  c.Vel.x[ball] = 0
  c.Vel.y[ball] = 0
  c.Air.z[ball] = 0
  c.Air.vz[ball] = 0
  m.ball.owner = -1
}

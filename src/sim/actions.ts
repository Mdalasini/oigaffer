// Primitive ball actions. Everything that changes who touched the ball goes
// through here so possession bookkeeping and events stay in one place.

import { emit, type KickDetail, type KickKind } from './events'
import { DT } from './constants'
import { IntentKind, setIntent } from './intents'
import type { Sim } from './sim'

/** Seconds after striking the ball before the same player can touch it again. */
const KICK_RECOVERY = 0.3

function recordTouch(sim: Sim, eid: number) {
  const { m, c } = sim
  m.ball.lastKick = ''
  if (c.Player.team[eid] !== m.ball.backPassTeam) m.ball.backPassTeam = -1
  if (eid !== m.ball.indirectFrom) m.ball.indirectFrom = -1
  m.ball.lastTouch = eid
  m.ball.lastTeam = c.Player.team[eid]
  m.ball.touchTick = m.tick
  m.possession = c.Player.team[eid]
  c.Brain.lastTouch[eid] = m.tick
}

/** Strikes the ball away from the player; the ball becomes loose. */
export function kick(
  sim: Sim,
  eid: number,
  vx: number,
  vy: number,
  vz: number,
  kind: KickKind,
  to = -1,
  detail: KickDetail = {},
): void {
  const { c, m, ball } = sim
  c.Vel.x[ball] = vx
  c.Vel.y[ball] = vy
  c.Air.vz[ball] = vz
  m.ball.owner = -1
  m.ball.inHands = false
  recordTouch(sim, eid)
  m.ball.lastKick = kind
  m.ball.backPassTeam = kind === 'pass' ? c.Player.team[eid] : -1
  c.Brain.noTouchUntil[eid] = m.tick + Math.round(KICK_RECOVERY / DT)
  emit(sim, { type: 'kick', by: eid, kind, to, x: c.Pos.x[ball], y: c.Pos.y[ball], ...detail })
  if (to >= 0) {
    setIntent(sim, to, IntentKind.Receive, eid)
    c.Plan.type[to] = -1
  }
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

/**
 * First touch on a loose ball. A clean touch leaves the ball moving with the
 * player plus a nudge along (nx, ny); a heavy one knocks it away loose.
 */
export function takeControl(sim: Sim, eid: number, clean = true, nx = 0, ny = 0): void {
  const { c, m, ball } = sim
  c.Air.z[ball] = 0
  c.Air.vz[ball] = 0
  recordTouch(sim, eid)
  if (clean) {
    c.Vel.x[ball] = c.Vel.x[eid] + nx
    c.Vel.y[ball] = c.Vel.y[eid] + ny
    m.ball.owner = eid
    c.Brain.gotBall[eid] = m.tick
  } else {
    c.Vel.x[ball] = nx
    c.Vel.y[ball] = ny
    c.Brain.noTouchUntil[eid] = m.tick + 5
  }
  emit(sim, { type: 'control', by: eid, x: c.Pos.x[ball], y: c.Pos.y[ball], clean })
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
  m.ball.inHands = false
}

// Team shape: where each player stands when they have no more urgent job,
// derived from the formation slot, the ball and whether the team has it.

import { clamp } from './fmath'
import { keeperPosition } from './keeper'
import { believe, type Belief } from './perception'
import { HALF_LENGTH, HALF_WIDTH } from './pitch'
import { attackDir, type Sim } from './sim'

export interface Point {
  x: number
  y: number
}

const ball: Belief = { x: 0, y: 0, vx: 0, vy: 0 }

/** Shape target for a player in world coordinates, from where they believe the ball is. */
export function shapeTarget(sim: Sim, eid: number, out: Point): Point {
  const { Player } = sim.c
  const team = Player.team[eid]
  const slot = sim.formations[team].slots[Player.slot[eid]]
  if (slot.role === 'GK') return keeperPosition(sim, eid, out)
  const dir = attackDir(sim, team)
  believe(sim, eid, sim.ball, ball)
  const bx = ball.x * dir
  const by = ball.y * dir
  const inPossession = sim.m.possession === team

  const base = inPossession ? slot.attack : slot.defend
  // The block slides with the ball, and squeezes up and narrows without it.
  const shiftX = clamp(bx * (inPossession ? 0.6 : 0.5), -24, 24)
  const shiftY = by * (inPossession ? 0.2 : 0.4)
  const narrow = inPossession ? 1 : 0.85
  const ax = clamp(base[0] + shiftX, -HALF_LENGTH + 4, HALF_LENGTH - 4)
  const ay = clamp(base[1] * narrow + shiftY, -HALF_WIDTH + 1.5, HALF_WIDTH - 1.5)
  out.x = ax * dir
  out.y = ay * dir
  return out
}

/** Kick-off position: the defending shape pulled back inside the team's own half. */
export function kickOffTarget(sim: Sim, eid: number, kicking: boolean, out: Point): Point {
  const { Player } = sim.c
  const team = Player.team[eid]
  const slot = sim.formations[team].slots[Player.slot[eid]]
  const dir = attackDir(sim, team)
  let [ax, ay] = slot.defend
  ax = Math.min(ax, -1.5)
  // Opponents must stay outside the centre circle until the ball is played.
  if (!kicking && Math.sqrt(ax * ax + ay * ay) < 10) ax = -Math.sqrt(Math.max(0, 100 - ay * ay))
  out.x = ax * dir
  out.y = ay * dir
  return out
}

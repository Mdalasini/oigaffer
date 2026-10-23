// The referee: offside, fouls (free kicks, penalties, advantage) and cards.
// Watches the tick's events after the ball has moved and been played, and
// stops play by awarding a restart.

import { TICK_RATE } from './constants'
import { emit, type EventOf } from './events'
import { IntentKind, setIntent } from './intents'
import { awardFreeKick } from './match'
import { HALF_LENGTH, HALF_WIDTH, PENALTY_AREA_DEPTH, PENALTY_AREA_WIDTH, PENALTY_SPOT_DISTANCE } from './pitch'
import { chance } from './rng'
import { attackDir, roleOf, syncRoster, teamOf, type Sim } from './sim'
import { Phase, Restart } from './state'

/** Margin (m) by which a player must be ahead to be judged offside. */
const OFFSIDE_MARGIN = 0.1
/** Fouls before a player is booked for persistent fouling. */
const PERSISTENT = 3
/** How long the referee waits to see if advantage comes to anything. */
const ADVANTAGE_TICKS = Math.round(1.5 * TICK_RATE)

/** Players of `team` in an offside position at the moment a teammate plays the ball. */
function offsidePositions(sim: Sim, kicker: number): number[] {
  const { Pos } = sim.c
  const team = teamOf(sim, kicker)
  const dir = attackDir(sim, team)
  let last = -Infinity
  let second = -Infinity
  for (const o of sim.teams[1 - team]) {
    const ax = Pos.x[o] * dir
    if (ax > last) {
      second = last
      last = ax
    } else if (ax > second) second = ax
  }
  const ballAx = Pos.x[sim.ball] * dir
  const out: number[] = []
  for (const t of sim.teams[team]) {
    if (t === kicker) continue
    const ax = Pos.x[t] * dir
    if (ax > 0 && ax > ballAx + OFFSIDE_MARGIN && ax > second + OFFSIDE_MARGIN) out.push(t)
  }
  return out
}

/**
 * Runs twice a tick: after players act (before the ball moves, so offside
 * is judged where everyone was when the ball was played, and offences beat
 * any goal or out-of-play call), and after possession is settled.
 */
export function refereeSystem(sim: Sim): void {
  const { m } = sim
  while (m.refSeen < m.events.length) {
    const e = m.events[m.refSeen++]
    if (m.phase !== Phase.Play) return
    if (e.type === 'tackle' && e.outcome === 'foul') foul(sim, e)
    else if (e.type === 'kick') played(sim, e.by, e)
    else if (e.type === 'control') played(sim, e.by, null)
  }
  if (m.phase === Phase.Play) adjudicateAdvantage(sim)
}

/** Advantage stands once the fouled side has the ball; otherwise it comes back for the free kick. */
function adjudicateAdvantage(sim: Sim) {
  const { m } = sim
  const adv = m.advantage
  if (adv.team < 0) return
  const owner = m.ball.owner
  if (owner >= 0 && teamOf(sim, owner) === adv.team) {
    adv.team = -1
    return
  }
  if ((owner >= 0 && teamOf(sim, owner) !== adv.team) || m.tick >= adv.until) {
    const { team, x, y, by, on } = adv
    adv.team = -1
    emit(sim, { type: 'foul', by, on, x, y, award: 'free-kick' })
    whistle(sim, Restart.FreeKick, team, x, y, false)
  }
}

/**
 * Someone played the ball. If they were in an offside position when a
 * teammate last played it, that is an offence; otherwise their touch sets
 * who is offside for the next phase, and an opponent's touch clears it. A
 * keeper's save is not a touch that resets offside, so is not passed here.
 */
function played(sim: Sim, eid: number, kick: EventOf<'kick'> | null) {
  const { m, c } = sim
  const team = teamOf(sim, eid)
  const off = m.offside
  if (off.team === team && off.players.includes(eid)) {
    emit(sim, { type: 'offside', by: eid, x: c.Pos.x[eid], y: c.Pos.y[eid] })
    return whistle(sim, Restart.FreeKick, 1 - team, c.Pos.x[eid], c.Pos.y[eid], true)
  }
  if (off.team !== team) {
    off.team = -1
    off.players = []
  }
  // No offside straight from a throw-in, goal kick or corner.
  const exempt =
    kick !== null &&
    kick.tick === m.phaseTick &&
    (m.restart.kind === Restart.ThrowIn || m.restart.kind === Restart.GoalKick || m.restart.kind === Restart.Corner)
  if (kick?.kind !== 'tackle' && !exempt) {
    off.team = team
    off.players = offsidePositions(sim, eid)
  }
}

function foul(sim: Sim, e: EventOf<'tackle'>) {
  const { m } = sim
  const fouler = e.by
  const fouled = e.on
  const team = teamOf(sim, fouled)
  m.fouls[fouler] = (m.fouls[fouler] ?? 0) + 1
  const card = judge(sim, e)
  const inBox = inPenaltyArea(sim, 1 - team, e.x, e.y)
  // Wait and see in the opponents' half if a teammate is on hand to carry on; called back if nothing comes of it.
  const advantage = !inBox && card !== 'red' && e.x * attackDir(sim, team) > 0 && teammateNearBall(sim, team, fouled, 2.5)
  emit(sim, { type: 'foul', by: fouler, on: fouled, x: e.x, y: e.y, award: inBox ? 'penalty' : advantage ? 'advantage' : 'free-kick' })
  if (card) book(sim, fouler, card, cardReason(sim, e, card))
  if (advantage) {
    m.advantage = { team, x: clampX(e.x), y: clampY(e.y), until: m.tick + ADVANTAGE_TICKS, by: fouler, on: fouled }
    return
  }
  if (inBox) {
    const dir = attackDir(sim, team)
    return whistle(sim, Restart.Penalty, team, dir * (HALF_LENGTH - PENALTY_SPOT_DISTANCE), 0, false)
  }
  whistle(sim, Restart.FreeKick, team, clampX(e.x), clampY(e.y), false)
}

const clampX = (x: number) => Math.max(-HALF_LENGTH + 0.5, Math.min(HALF_LENGTH - 0.5, x))
const clampY = (y: number) => Math.max(-HALF_WIDTH + 0.5, Math.min(HALF_WIDTH - 0.5, y))

type Card = 'yellow' | 'red' | null

/** The card a foul deserves. */
function judge(sim: Sim, e: EventOf<'tackle'>): Card {
  const { c, m } = sim
  const fouler = e.by
  let card: Card = null
  if (e.reckless) card = chance(m.rng, 0.03 + 0.07 * c.Attr.aggression[fouler]) ? 'red' : 'yellow'
  if (deniesGoal(sim, e)) card = inPenaltyArea(sim, teamOf(sim, fouler), e.x, e.y) && e.kind !== 'slide' ? 'yellow' : 'red'
  if (!card && stopsAttack(sim, e) && chance(m.rng, 0.6)) card = 'yellow'
  if (!card && m.fouls[fouler] >= PERSISTENT && !(m.yellows[fouler] > 0)) card = 'yellow'
  return card
}

function cardReason(sim: Sim, e: EventOf<'tackle'>, card: 'yellow' | 'red'): string {
  if (deniesGoal(sim, e)) return 'denying a goal-scoring opportunity'
  if (e.reckless) return card === 'red' ? 'serious foul play' : 'reckless challenge'
  if (sim.m.fouls[e.by] >= PERSISTENT) return 'persistent fouling'
  return 'stopping a promising attack'
}

/** Fouled near goal, heading for it, with only the keeper (if anyone) left to beat. */
function deniesGoal(sim: Sim, e: EventOf<'tackle'>): boolean {
  const { c } = sim
  const team = teamOf(sim, e.on)
  const dir = attackDir(sim, team)
  const gx = dir * HALF_LENGTH
  const d = Math.sqrt((gx - e.x) * (gx - e.x) + e.y * e.y)
  if (d > 25) return false
  for (const o of sim.teams[1 - team]) {
    if (o === e.by || roleOf(sim, o) === 'GK') continue
    // A covering defender goal side of the ball means the chance was not clear.
    if ((c.Pos.x[o] - e.x) * dir > 0 && Math.abs(c.Pos.y[o] - e.y) < 12) return false
  }
  // How they were moving before the contact, not after.
  return e.onVx * dir > 1
}

/** Fouled in their own half running forward into space. */
function stopsAttack(sim: Sim, e: EventOf<'tackle'>): boolean {
  const team = teamOf(sim, e.on)
  const dir = attackDir(sim, team)
  return e.x * dir < 10 && e.onVx * dir > 4
}

function inPenaltyArea(sim: Sim, defending: number, x: number, y: number): boolean {
  const ax = x * attackDir(sim, defending)
  return ax < -HALF_LENGTH + PENALTY_AREA_DEPTH && Math.abs(y) < PENALTY_AREA_WIDTH / 2
}

/** A teammate of the fouled player (not them: they are on the floor) close enough to carry on. */
function teammateNearBall(sim: Sim, team: number, fouled: number, r: number): boolean {
  const { Pos } = sim.c
  for (const t of sim.teams[team]) {
    if (t === fouled) continue
    const dx = Pos.x[t] - Pos.x[sim.ball]
    const dy = Pos.y[t] - Pos.y[sim.ball]
    if (dx * dx + dy * dy < r * r) return true
  }
  return false
}

/** Shows a card; a second yellow is a red, and a red sends the player off. */
export function book(sim: Sim, eid: number, card: 'yellow' | 'red', reason: string): void {
  const { m } = sim
  if (card === 'yellow') {
    m.yellows[eid] = (m.yellows[eid] ?? 0) + 1
    emit(sim, { type: 'card', to: eid, color: 'yellow', reason })
    if (m.yellows[eid] < 2) return
    reason = 'second yellow card'
  }
  emit(sim, { type: 'card', to: eid, color: 'red', reason })
  sendOff(sim, eid)
}

/** Off the pitch for the rest of the match; with no substitutes the team plays a player short. */
function sendOff(sim: Sim, eid: number) {
  const { m, c } = sim
  const team = teamOf(sim, eid)
  // A team cannot play without a keeper: the nearest defender goes in goal.
  if (roleOf(sim, eid) === 'GK') {
    let stand = -1
    let bestD = Infinity
    for (const t of sim.teams[team]) {
      if (t === eid) continue
      const d = (c.Pos.x[t] - c.Pos.x[eid]) * (c.Pos.x[t] - c.Pos.x[eid]) + (c.Pos.y[t] - c.Pos.y[eid]) * (c.Pos.y[t] - c.Pos.y[eid])
      if (d < bestD) {
        stand = t
        bestD = d
      }
    }
    const slot = c.Player.slot[stand]
    c.Player.slot[stand] = c.Player.slot[eid]
    c.Player.slot[eid] = slot
  }
  m.sentOff.push(eid)
  if (m.ball.owner === eid) m.ball.owner = -1
  setIntent(sim, eid, IntentKind.Wait)
  c.Pos.x[eid] = 0
  c.Pos.y[eid] = (team === 0 ? -1 : 1) * (HALF_WIDTH + 3)
  c.Vel.x[eid] = 0
  c.Vel.y[eid] = 0
  syncRoster(sim)
}

/** Stops play for a free kick or penalty. Free kicks for offside are indirect. */
function whistle(sim: Sim, kind: Restart, team: number, x: number, y: number, indirect: boolean) {
  awardFreeKick(sim, kind, team, x, y, indirect)
}

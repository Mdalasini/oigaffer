import { query } from 'bitecs'
import { Offside, Position, Team } from './components'
import { offsideCalled, type Match } from './match'
import { along, onsideLimit } from './shape'

/**
 * Whether `eid` is in an offside position: in the opponents' half, and
 * nearer their goal line than both the ball and the second-last opponent.
 * Being level is onside.
 */
export function inOffsidePosition(world: Match, eid: number): boolean {
  const team = Team.id[eid]
  return along(team, Position.x[eid]) > onsideLimit(world, team)
}

/**
 * `toucher` has just played the ball on purpose (a touch, pass, shot or
 * first touch). Offside is judged now: each teammate in an offside position
 * is flagged until the team next plays it. The toucher themselves is
 * involved by playing it, so they are never flagged. The first touch of a
 * throw-in, corner or goal kick judges nobody.
 */
export function playedBy(world: Match, toucher: number) {
  const team = Team.id[toucher]
  const exempt = world.offsideExempt
  world.offsideExempt = false
  for (const eid of query(world, [Offside, Team])) {
    if (Team.id[eid] !== team) Offside.flagged[eid] = 0
    else Offside.flagged[eid] = eid !== toucher && !exempt && inOffsidePosition(world, eid) ? 1 : 0
  }
}

/** No one is flagged: the other team has played the ball, or play has stopped. */
export function clearOffside(world: Match) {
  for (const eid of query(world, [Offside])) Offside.flagged[eid] = 0
}

/**
 * `eid` is about to play the ball. If they were flagged, that's an offence:
 * play stops for the other team's free kick. Returns whether it did.
 */
export function offsideOffence(world: Match, eid: number): boolean {
  if (!Offside.flagged[eid]) return false
  offsideCalled(world, eid)
  clearOffside(world)
  return true
}

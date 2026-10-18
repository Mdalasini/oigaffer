import { query } from 'bitecs'
import { Outfielder, Team, Velocity } from '../components'
import { handOver, winBall, type Match } from '../match'
import { ballAtFeet, canPlayBall, CONTROL_RADIUS, footDistance } from '../touch'

/** Beyond the carrier's control, another player must be at least this much nearer to call it theirs. */
const LOOSE_MARGIN = 0.4
/** Fastest the ball can be moving relative to a player and still be gathered cleanly. */
const MAX_GATHER_SPEED = 6

/**
 * Resolves who comes away with a ball that has got away from the carrier:
 * the nearest other outfielder who can play it. An opponent wins it; a
 * teammate simply takes it on. A ball still under the carrier's control has
 * to be tackled for.
 */
export function contestSystem(world: Match, _dt: number) {
  if (world.phase !== 'play') return
  const { ball, carrier } = world
  const carrierDistance = footDistance(carrier, ball)
  if (carrierDistance <= CONTROL_RADIUS) return
  let winner = -1
  let nearest = Infinity
  for (const eid of query(world, [Outfielder])) {
    if (eid === carrier || !canPlayBall(world, eid) || !ballAtFeet(eid, ball)) continue
    const distance = footDistance(eid, ball)
    const relativeSpeed = Math.hypot(Velocity.x[ball] - Velocity.x[eid], Velocity.y[ball] - Velocity.y[eid])
    if (carrierDistance - distance < LOOSE_MARGIN || relativeSpeed > MAX_GATHER_SPEED || distance >= nearest) continue
    winner = eid
    nearest = distance
  }
  if (winner === -1) return
  if (Team.id[winner] === world.possession) return handOver(world, winner)
  Velocity.x[ball] = Velocity.x[winner]
  Velocity.y[ball] = Velocity.y[winner]
  winBall(world, winner, 'intercepted')
}

import { query } from 'bitecs'
import { Dribbler, Outfielder, Position, Team, Velocity } from '../components'
import { handOver, winBall, type Match } from '../match'
import { offsideOffence } from '../offside'
import { ballAtFeet, canPlayBall, CONTROL_RADIUS, footDistance, footX, footY } from '../touch'
import { hypot } from '../fmath'

/** Beyond the carrier's control, another player must be at least this much nearer to call it theirs. */
const LOOSE_MARGIN = 0.4
/** Fastest the ball can be moving relative to a player and still be gathered cleanly. */
const MAX_GATHER_SPEED = 6
/**
 * A ball coming too hard to gather that an opponent's foot is in the way of:
 * passing within this far (m) of it, they cut it out cleanly; further out, at
 * a stretch, they only get a touch on it.
 */
const CUT_OUT_REACH = 0.4
/** Share of its speed, relative to them, that a ball keeps when an opponent stretches and gets a touch on it. */
const DEFLECT_KEEP = 0.3

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
  let stopper = -1
  let stopperDistance = Infinity
  for (const eid of query(world, [Outfielder])) {
    // Someone who has just passed or shot can't take it straight back.
    if (eid === carrier || Dribbler.cooldown[eid] > 0 || !canPlayBall(world, eid) || !ballAtFeet(eid, ball)) continue
    const distance = footDistance(eid, ball)
    if (carrierDistance - distance < LOOSE_MARGIN) continue
    const rvx = Velocity.x[ball] - Velocity.x[eid]
    const rvy = Velocity.y[ball] - Velocity.y[eid]
    const relativeSpeed = hypot(rvx, rvy)
    if (relativeSpeed > MAX_GATHER_SPEED) {
      // Too hard to gather in stride: a teammate it wasn't meant for lets it run, as does someone it's just come
      // off, but an opponent in its way stops it.
      if (Team.id[eid] === world.possession || world.lastTouchedBy === eid) continue
      // How close it passes their foot, so a ball coming straight at them isn't judged on where it first came into reach.
      const miss = Math.abs((Position.x[ball] - footX(eid)) * rvy - (Position.y[ball] - footY(eid)) * rvx) / relativeSpeed
      if (miss > CUT_OUT_REACH) {
        if (distance < stopperDistance) {
          stopper = eid
          stopperDistance = distance
        }
        continue
      }
    }
    if (distance >= nearest) continue
    winner = eid
    nearest = distance
  }
  if (winner === -1) {
    if (stopper !== -1) deflect(world, stopper)
    return
  }
  if (Team.id[winner] === world.possession) {
    if (!offsideOffence(world, winner)) handOver(world, winner)
    return
  }
  Velocity.x[ball] = Velocity.x[winner]
  Velocity.y[ball] = Velocity.y[winner]
  winBall(world, winner, 'intercepted')
}

/**
 * An opponent stretches and gets a touch on a ball coming too hard to gather:
 * it takes the pace off it, and the pass is over. Whoever is nearest the loose
 * ball then gathers it, most often the one who stopped it.
 */
function deflect(world: Match, eid: number) {
  const { ball } = world
  Velocity.x[ball] = Velocity.x[eid] + (Velocity.x[ball] - Velocity.x[eid]) * DEFLECT_KEEP
  Velocity.y[ball] = Velocity.y[eid] + (Velocity.y[ball] - Velocity.y[eid]) * DEFLECT_KEEP
  world.lastTouchedBy = eid
  world.lastTouchDeliberate = false
  world.pass = null
}

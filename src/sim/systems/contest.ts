import { Velocity } from '../components'
import { endAttack, type Match } from '../match'
import { ballAtFeet, CONTROL_RADIUS, footDistance } from '../touch'

/** Beyond the carrier's control, the defender must be at least this much nearer to call it theirs. */
const LOOSE_MARGIN = 0.4
/** Fastest the ball can be moving relative to the defender and still be gathered cleanly. */
const MAX_GATHER_SPEED = 6

/**
 * Resolves who comes away with the ball when the defender can reach it.
 * Only a ball that has got away from the carrier is won here; one still
 * under their control has to be tackled for.
 */
export function contestSystem(world: Match, _dt: number) {
  if (!world.defenderActive || world.phase !== 'approach') return
  const { ball, striker, defender } = world
  if (!ballAtFeet(defender, ball)) return
  const carrierDistance = footDistance(striker, ball)
  const loose = carrierDistance > CONTROL_RADIUS && carrierDistance - footDistance(defender, ball) >= LOOSE_MARGIN
  const relativeSpeed = Math.hypot(Velocity.x[ball] - Velocity.x[defender], Velocity.y[ball] - Velocity.y[defender])
  if (loose && relativeSpeed <= MAX_GATHER_SPEED) {
    Velocity.x[ball] = Velocity.x[defender]
    Velocity.y[ball] = Velocity.y[defender]
    endAttack(world, 'intercepted', null)
  }
}

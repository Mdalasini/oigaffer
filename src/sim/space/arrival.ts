import { hasComponent, type World } from 'bitecs'
import { angleDelta } from '../angles'
import { Facing, Goalkeeper, Physical, Position, Velocity } from '../components'
import { accelerationRate, topSpeed, turnRate } from '../grades'

/** Seconds before a player responds to something new: until then they carry on as they were. */
export const REACTION_TIME = 0.2
/** A keeper off their line covers ground more slowly than an outfielder. */
const KEEPER_SPEED = 6
const KEEPER_ACCEL = 8
/** Turning is slower at speed: the turn rate halves at this speed (m/s), as in locomotion. */
const TURN_FALLOFF_SPEED = 2.5

/**
 * Seconds `eid` needs to get within `reach` metres of (x, y). They react
 * first, carrying on at their current velocity. Then they turn towards the
 * spot, and run there from whatever speed they already have in that
 * direction, accelerating up to top speed.
 *
 * This is the arrival-time model from pitch-control research. It is quick to
 * evaluate, which matters more here than precision.
 */
export function arrivalTime(world: World, eid: number, x: number, y: number, reach = 0, reaction = REACTION_TIME): number {
  if (Math.hypot(x - Position.x[eid], y - Position.y[eid]) <= reach) return 0
  const vx = Velocity.x[eid]
  const vy = Velocity.y[eid]
  const dx = x - (Position.x[eid] + vx * reaction)
  const dy = y - (Position.y[eid] + vy * reaction)
  const gap = Math.hypot(dx, dy)
  // Carried within reach while still reacting.
  if (gap <= reach) return reaction
  const ux = dx / gap
  const uy = dy / gap
  const speed = Math.hypot(vx, vy)
  const along = Math.max(0, vx * ux + vy * uy)

  const keeper = hasComponent(world, eid, Goalkeeper)
  const top = keeper ? KEEPER_SPEED : topSpeed(Physical.pace[eid])
  const accel = keeper ? KEEPER_ACCEL : accelerationRate(Physical.acceleration[eid])
  // Keepers stay square to the ball and move sideways, so only outfielders pay to turn.
  const turn = keeper ? 0 : Math.abs(angleDelta(Facing.angle[eid], Math.atan2(uy, ux))) / (turnRate(Physical.agility[eid]) / (1 + speed / TURN_FALLOFF_SPEED))
  return reaction + turn + runTime(gap - reach, Math.min(along, top), top, accel)
}

/** Seconds to cover `distance` starting at `v0`, accelerating at `accel` up to `top`. */
function runTime(distance: number, v0: number, top: number, accel: number): number {
  const tAccel = (top - v0) / accel
  const dAccel = v0 * tAccel + 0.5 * accel * tAccel * tAccel
  if (distance <= dAccel) return (-v0 + Math.sqrt(v0 * v0 + 2 * accel * distance)) / accel
  return tAccel + (distance - dAccel) / top
}

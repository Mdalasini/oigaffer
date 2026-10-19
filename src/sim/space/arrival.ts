import { angleDelta } from '../angles'
import { Facing, Physical, Position, Velocity } from '../components'
import { accelerationRate, topSpeed, turnRate } from '../grades'
import type { Match } from '../match'
import { view, type View } from '../perception'
import { atan2 } from '../fmath'

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
 *
 * Judged by `by` (see `perception`), it's from where they reckon `eid` is and
 * how they last saw them moving; by default, from the truth.
 */
export function arrivalTime(world: Match, eid: number, x: number, y: number, reach = 0, reaction = REACTION_TIME, by = -1): number {
  const truth = by === -1 || by === eid
  if (!truth) view(world, by, eid, seen)
  const vx = truth ? Velocity.x[eid] : seen.vx
  const vy = truth ? Velocity.y[eid] : seen.vy
  const ox = (truth ? Position.x[eid] : seen.x) - x
  const oy = (truth ? Position.y[eid] : seen.y) - y
  if (ox * ox + oy * oy <= reach * reach) return 0
  // Carried within reach while still reacting: the first moment their path enters it.
  const a = vx * vx + vy * vy
  const b = 2 * (ox * vx + oy * vy)
  const c = ox * ox + oy * oy - reach * reach
  const disc = b * b - 4 * a * c
  if (a > 0 && disc >= 0) {
    const t = (-b - Math.sqrt(disc)) / (2 * a)
    if (t >= 0 && t <= reaction) return t
  }
  const dx = -(ox + vx * reaction)
  const dy = -(oy + vy * reaction)
  const gap = Math.sqrt(dx * dx + dy * dy)
  const ux = dx / gap
  const uy = dy / gap
  const speed = Math.sqrt(a)
  const along = Math.max(0, vx * ux + vy * uy)

  const keeper = isKeeper(world, eid)
  const top = keeper ? KEEPER_SPEED : topSpeed(Physical.pace[eid])
  const accel = keeper ? KEEPER_ACCEL : accelerationRate(Physical.acceleration[eid])
  // Keepers stay square to the ball and move sideways, so only outfielders pay to turn.
  const facing = truth ? Facing.angle[eid] : seen.facing
  const turn = keeper ? 0 : Math.abs(angleDelta(facing, atan2(uy, ux))) / (turnRate(Physical.agility[eid]) / (1 + speed / TURN_FALLOFF_SPEED))
  return reaction + turn + runTime(gap - reach, Math.min(along, top), top, accel)
}

/** Scratch for how the judge sees the player being timed; read straight out, never held across calls. */
const seen: View = { x: 0, y: 0, vx: 0, vy: 0, facing: 0 }

/** Whether `eid` is either side's goalkeeper. */
export const isKeeper = (world: Match, eid: number) => eid === world.teams[0].keeper || eid === world.teams[1].keeper

/**
 * The fastest (m/s) `eid` can be moving at any point on the way somewhere:
 * no one speeds up past their top speed, though they may already be going faster.
 */
export function fastest(world: Match, eid: number, by = -1): number {
  const top = isKeeper(world, eid) ? KEEPER_SPEED : topSpeed(Physical.pace[eid])
  view(world, by, eid, seen)
  return Math.max(top, Math.sqrt(seen.vx * seen.vx + seen.vy * seen.vy))
}

/** Seconds to cover `distance` starting at `v0`, accelerating at `accel` up to `top`. */
function runTime(distance: number, v0: number, top: number, accel: number): number {
  const tAccel = (top - v0) / accel
  const dAccel = v0 * tAccel + 0.5 * accel * tAccel * tAccel
  if (distance <= dAccel) return (-v0 + Math.sqrt(v0 * v0 + 2 * accel * distance)) / accel
  return tAccel + (distance - dAccel) / top
}

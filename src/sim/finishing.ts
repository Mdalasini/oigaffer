import { angleDelta } from './angles'
import { Facing, Outfielder, Position, Team } from './components'
import { shotAngleError } from './grades'
import type { Match } from './match'
import { BALL_RADIUS, GOAL_HALF_WIDTH, GOAL_HEIGHT } from './constants'
import { chooseAim, VERTICAL_ERROR, type GoalPoint } from './shooting'
import { diveReach } from './systems/keeper'
import { attackedGoalX } from './teams'

// How hard (m/s) a shot is struck: placed from close in, driven from further
// out. Power costs accuracy: the error scales with the pace over POWER_REFERENCE.
const PLACED_SPEED = 18
const DRIVEN_SPEED = 28
const SPEED_PER_METRE = 0.6
const POWER_REFERENCE = 24
/** The keeper's reaction a shooter reckons on (s): they can't know the keeper's grade. */
const TYPICAL_REACTION = 0.2

/** An opponent within this distance (m) of the shooter hurries the shot, more the closer they are. */
const PRESSURE_RANGE = 3
/** Right on top of them, a shot goes this many times further off line. */
const FULL_PRESSURE = 2.2
/** Beyond this angle (rad) between facing and the goal, the shot is struck across the body, and goes less true. */
const CLEAN_TURN = 0.5
/** Each radian further round adds this much to the error. */
const ACROSS_BODY = 1.2
/** However hurried and twisted, a shot goes no further off line than this (rad), about 40°. */
const WILDEST = 0.7

/** The shot `carrier` would take from where the ball is now: where they'd aim, and how far off they'd expect to be. */
export interface ShotPlan {
  goalX: number
  aim: GoalPoint
  /** Standard deviation (m) of where it lands around the aim, on the goal plane. */
  miss: number
  /** Standard deviation (rad) of the strike's direction. */
  error: number
  /** How hard (m/s) it's struck. */
  speed: number
}

/**
 * How far off line `carrier`'s shot would go, in radians: their finishing,
 * made worse by an opponent close enough to hurry them and by having to
 * shoot across their body.
 */
export function shotError(world: Match, carrier: number): number {
  const team = Team.id[carrier]
  const x = Position.x[carrier]
  const y = Position.y[carrier]
  let nearest = Infinity
  for (const eid of world.teams[1 - team].outfielders) nearest = Math.min(nearest, Math.hypot(Position.x[eid] - x, Position.y[eid] - y))
  const hurried = 1 + (FULL_PRESSURE - 1) * Math.max(0, 1 - nearest / PRESSURE_RANGE)
  const toGoal = Math.atan2(-Position.y[world.ball], attackedGoalX(team) - Position.x[world.ball])
  const across = 1 + ACROSS_BODY * Math.max(0, Math.abs(angleDelta(Facing.angle[carrier], toGoal)) - CLEAN_TURN)
  return shotAngleError(Outfielder.shooting[carrier]) * hurried * across
}

/** The shot `carrier` would take now, at the corner away from the keeper, aimed as safe as their expected miss needs. */
export function planShot(world: Match, carrier: number): ShotPlan {
  const goalX = attackedGoalX(Team.id[carrier])
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  const keeperY = Position.y[world.keeper]
  const rough = chooseAim(by, keeperY, world.aimHigh)
  const distance = Math.hypot(goalX - bx, rough.y - by)
  const speed = Math.min(DRIVEN_SPEED, PLACED_SPEED + SPEED_PER_METRE * Math.max(0, distance - 6))
  const error = Math.min(WILDEST, (shotError(world, carrier) * speed) / POWER_REFERENCE)
  // The miss on the goal plane grows with the distance to the corner being aimed at.
  const miss = distance * Math.tan(error)
  return { goalX, error, miss, speed, aim: chooseAim(by, keeperY, world.aimHigh, miss) }
}

/**
 * What `carrier` reckons a shot from here is worth: the chance it goes in
 * between the post and as far as the keeper can reach in the time it takes
 * to get there, and under the bar. They see where the keeper is standing and
 * know how true they strike it, hurried or not.
 */
export function shotValue(world: Match, carrier: number): number {
  const { goalX, aim, miss, speed } = planShot(world, carrier)
  const keeper = world.keeper
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  const toGoal = goalX - bx
  const toKeeper = Position.x[keeper] - bx
  if (Math.abs(toGoal) < 0.1) return 0
  // A keeper the ball is already past can't stop it.
  if (toKeeper / toGoal <= 0) return landingChance(aim, miss, null)
  // The keeper's reach, seen from the ball, projected back onto the goal line.
  const scale = Math.abs(toKeeper) > 0.5 ? toGoal / toKeeper : 1
  const flight = Math.hypot(toKeeper, (aim.y - by) * (toKeeper / toGoal)) / speed
  const centre = by + (Position.y[keeper] - by) * scale
  const reach = diveReach(keeper, flight - TYPICAL_REACTION, Math.hypot(toKeeper, Position.y[keeper] - by)) * scale
  return landingChance(aim, miss, { centre, reach })
}

/**
 * The chance a shot aimed at `aim`, landing off it by a normal error of
 * `miss` (m), goes in: inside the posts and under the bar, and clear of a
 * keeper who can reach `reach` metres either side of `centre` on the goal
 * line, if there is one in the way.
 */
export function landingChance(aim: GoalPoint, miss: number, keeper: { centre: number; reach: number } | null): number {
  // The open parts of the goal either side of the keeper: a wild shot can beat them on the other side.
  const post = GOAL_HALF_WIDTH - BALL_RADIUS
  const centre = keeper?.centre ?? 0
  const reach = keeper?.reach ?? -Infinity
  if (miss <= 0) return Math.abs(aim.y) < post && Math.abs(aim.y - centre) > reach ? 1 : 0
  const within = (lo: number, hi: number) => (hi > lo ? normalCdf((hi - aim.y) / miss) - normalCdf((lo - aim.y) / miss) : 0)
  const across = keeper
    ? within(Math.max(-post, centre + reach), post) + within(-post, Math.min(post, centre - reach))
    : within(-post, post)
  const height = miss * VERTICAL_ERROR
  // A shot struck into the ground still goes in low, so only the bar counts.
  const under = normalCdf((GOAL_HEIGHT - BALL_RADIUS - aim.z) / height)
  return across * under
}

/** The standard normal cumulative distribution, by the Abramowitz–Stegun approximation. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

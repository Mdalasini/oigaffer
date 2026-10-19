import { angleDelta } from './angles'
import { Body, Facing, Outfielder, Position, Team } from './components'
import { shotAngleError } from './grades'
import type { Match } from './match'
import { BALL_RADIUS, GOAL_HALF_WIDTH, GOAL_HEIGHT } from './constants'
import { chooseAim, VERTICAL_ERROR, type GoalPoint } from './shooting'
import { diveReach } from './systems/keeper'
import { LEG_WIDTH } from './systems/collision'
import { seenX, seenY } from './perception'
import { attackedGoalX } from './teams'
import { atan2, exp, hypot, tan } from './fmath'

// How hard (m/s) a shot is struck: placed from close in, driven from further
// out. Power costs accuracy: the error scales with the pace over POWER_REFERENCE.
const PLACED_SPEED = 16
const DRIVEN_SPEED = 31
const SPEED_PER_METRE = 0.9
const POWER_REFERENCE = 24
/** The keeper's reaction a shooter reckons on (s): they can't know the keeper's grade. */
const TYPICAL_REACTION = 0.2
const QUARTER_TURN = Math.PI / 2

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
/** A shot struck first time, without a touch to set it, goes this many times further off line. */
const FIRST_TIME_ERROR = 1.4
/** However slanted the shot, it's reckoned as struck from at least this far (m) out from the goal line. */
const MIN_SQUARE_ON = 0.5

/** The shot `carrier` would take from where the ball is now: where they'd aim, and how far off they'd expect to be. */
export interface ShotPlan {
  goalX: number
  aim: GoalPoint
  /** Standard deviation (m) of where it lands across the goal plane, around the aim. */
  miss: number
  /** Standard deviation (m) of where it lands up and down the goal plane. */
  rise: number
  /** Standard deviation (rad) of the strike's direction. */
  error: number
  /** How hard (m/s) it's struck. */
  speed: number
}

/**
 * How far off line `carrier`'s shot would go, in radians: their finishing,
 * made worse by an opponent close enough to hurry them and by having to
 * shoot across their body. Reckoned by `by`, the hurry is from opponents
 * where they last saw them; struck, it's from the real ones.
 */
export function shotError(world: Match, carrier: number, by = -1): number {
  const team = Team.id[carrier]
  const x = Position.x[carrier]
  const y = Position.y[carrier]
  let nearest = Infinity
  for (const eid of world.teams[1 - team].outfielders) nearest = Math.min(nearest, hypot(seenX(world, by, eid) - x, seenY(world, by, eid) - y))
  const hurried = 1 + (FULL_PRESSURE - 1) * Math.max(0, 1 - nearest / PRESSURE_RANGE)
  const toGoal = atan2(-Position.y[world.ball], attackedGoalX(world.pitch, team) - Position.x[world.ball])
  const across = 1 + ACROSS_BODY * Math.max(0, Math.abs(angleDelta(Facing.angle[carrier], toGoal)) - CLEAN_TURN)
  return shotAngleError(Outfielder.shooting[carrier]) * hurried * across
}

/**
 * The shot `carrier` would take now, at the corner away from the keeper,
 * aimed as safe as their expected miss needs; as `judge` reckons it, or as
 * it really is. Struck `firstTime`, it goes less true.
 */
export function planShot(world: Match, carrier: number, judge = -1, firstTime = false): ShotPlan {
  const goalX = attackedGoalX(world.pitch, Team.id[carrier])
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  const keeperY = seenY(world, judge, world.keeper)
  const rough = chooseAim(by, keeperY, world.aimHigh)
  const distance = hypot(goalX - bx, rough.y - by)
  const speed = Math.min(DRIVEN_SPEED, PLACED_SPEED + SPEED_PER_METRE * Math.max(0, distance - 6))
  const error = Math.min(WILDEST, (shotError(world, carrier, judge) * speed * (firstTime ? FIRST_TIME_ERROR : 1)) / POWER_REFERENCE)
  // The miss on the goal plane grows with the distance to the corner being aimed at, and across
  // it with how slanted the shot meets the plane: from near the byline, a sliver off line is
  // metres along the goal line.
  const rise = distance * tan(error)
  const miss = (rise * distance) / Math.max(MIN_SQUARE_ON, Math.abs(goalX - bx))
  return { goalX, error, miss, rise: rise * VERTICAL_ERROR, speed, aim: chooseAim(by, keeperY, world.aimHigh, miss) }
}

/** A stretch of the goal plane, across goal from `lo` to `hi` (m), that shots can't get through. */
export interface Stretch {
  lo: number
  hi: number
}

/**
 * What `carrier` reckons a shot from here is worth: the chance it goes in
 * between the posts and under the bar, clear of the legs of anyone in the way
 * and of as far as the keeper can reach in the time it takes to get there.
 * They judge it from where they last saw the keeper and everyone else, and
 * know how true they strike it, first time or not.
 */
export function shotValue(world: Match, carrier: number, firstTime = false): number {
  const { goalX, aim, miss, rise, speed } = planShot(world, carrier, carrier, firstTime)
  const keeper = world.keeper
  const kx = seenX(world, carrier, keeper)
  const ky = seenY(world, carrier, keeper)
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  const toGoal = Math.abs(goalX - bx)
  if (toGoal < 0.1) return 0
  const dir = Math.sign(goalX - bx)
  // Where on the goal plane a line from the ball through (x, y), x ahead of it towards goal, comes out.
  const through = (x: number, y: number) => (x > 0 ? by + ((y - by) * toGoal) / x : y >= by ? Infinity : -Infinity)
  const blocked = legsInTheWay(world, carrier, dir, toGoal)
  const ahead = (kx - bx) * dir
  // A keeper the ball is already past can't stop it.
  if (ahead + BALL_RADIUS > 0) {
    const flight = hypot(Math.max(0, ahead), ((aim.y - by) * Math.max(0, ahead)) / toGoal) / speed
    const reach = diveReach(keeper, flight - TYPICAL_REACTION, hypot(ahead, ky - by))
    // The stretch of their line the keeper can reach: an end level with or behind the ball shuts off that whole side.
    const ends = [ahead - BALL_RADIUS, ahead + BALL_RADIUS].flatMap((x) => [through(x, ky - reach), through(x, ky + reach)])
    blocked.push({ lo: Math.min(...ends), hi: Math.max(...ends) })
  }
  return landingChance(aim, miss, blocked, rise)
}

/**
 * The stretches of the goal plane that the legs of everyone `carrier` has
 * seen between the ball and goal would stop a shot getting to. They can't
 * know who'll stretch a leg out to block it, so they reckon on the legs alone.
 */
function legsInTheWay(world: Match, carrier: number, dir: number, toGoal: number): Stretch[] {
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  const blocked: Stretch[] = []
  for (const side of world.teams) {
    for (const eid of side.outfielders) {
      if (eid === carrier) continue
      const px = (seenX(world, carrier, eid) - bx) * dir
      const py = seenY(world, carrier, eid) - by
      if (px <= 0 || px >= toGoal) continue
      const legs = Body.radius[eid] * LEG_WIDTH + BALL_RADIUS
      const distance = hypot(px, py)
      if (distance <= legs) return [{ lo: -Infinity, hi: Infinity }]
      // The lines from the ball that just graze their legs, either side.
      const middle = atan2(py, px)
      const half = atan2(legs, Math.sqrt(distance * distance - legs * legs))
      const onPlane = (angle: number) => (angle >= QUARTER_TURN ? Infinity : angle <= -QUARTER_TURN ? -Infinity : by + toGoal * tan(angle))
      blocked.push({ lo: onPlane(middle - half), hi: onPlane(middle + half) })
    }
  }
  return blocked
}

/**
 * The chance a shot aimed at `aim`, landing off it by a normal error of
 * `miss` (m) across and `rise` (m) up and down, goes in: inside the posts
 * and under the bar, and through none of the `blocked` stretches, where the
 * keeper can reach or someone is in the way.
 */
export function landingChance(aim: GoalPoint, miss: number, blocked: readonly Stretch[] | null, rise = miss * VERTICAL_ERROR): number {
  // The open parts of the goal around whatever's in the way: a wild shot can beat the keeper on the other side.
  const post = GOAL_HALF_WIDTH - BALL_RADIUS
  const shut = (blocked ?? [])
    .map(({ lo, hi }) => ({ lo: Math.max(-post, lo), hi: Math.min(post, hi) }))
    .filter(({ lo, hi }) => hi > lo)
    .sort((a, b) => a.lo - b.lo)
  const within = (a: number, b: number) => (miss > 0 ? normalCdf((b - aim.y) / miss) - normalCdf((a - aim.y) / miss) : aim.y > a && aim.y < b ? 1 : 0)
  let across = 0
  let from = -post
  for (const { lo, hi } of shut) {
    if (lo > from) across += within(from, lo)
    from = Math.max(from, hi)
  }
  if (post > from) across += within(from, post)
  // A shot struck into the ground still goes in low, so only the bar counts.
  const under = rise > 0 ? normalCdf((GOAL_HEIGHT - BALL_RADIUS - aim.z) / rise) : aim.z < GOAL_HEIGHT - BALL_RADIUS ? 1 : 0
  return across * under
}

/** The standard normal cumulative distribution, by the Abramowitz–Stegun approximation. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * exp((-z * z) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

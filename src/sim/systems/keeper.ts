import { query } from 'bitecs'
import { Body, Facing, Goalkeeper, Position, Team, Velocity } from '../components'
import { BALL_RADIUS, GOAL_HALF_WIDTH } from '../constants'
import { cue } from '../cues'
import { handOver, setPhase, setVec, type Match } from '../match'
import { rollSpeedFor } from '../passing'
import { playBall } from '../offside'
import { gaussian } from '../rng'
import { passSafety } from '../space/control'
import { ownGoalX } from '../teams'

// How far off the line (m) the keeper stands, along the bisector of the
// angle the ball makes with the posts: a share of the ball's distance,
// between these limits. Far out they're off their line to sweep behind the
// defence and narrow the angle on a long shot; close in they stay nearer it,
// to have time to react. With nobody else between the ball and goal, they
// come off their line further to close the shooter down.
const ADVANCE_SHARE = 0.15
const ADVANCE_MIN = 1.2
const ADVANCE_MAX = 3
const ONE_ON_ONE_SHARE = 0.45
const ONE_ON_ONE_MAX = 7
/** Within this distance (m) of goal, a shooter with nobody else in the way is through on goal. */
const ONE_ON_ONE_RANGE = 20
const SET_SPEED = 4
const RUSH_SPEED = 6
const DIVE_SPEED = 5
const DIVE_ACCEL = 16
/** Furthest the keeper's centre goes beyond a post. */
const POST_OVERRUN = 0.4
/** Reach (m) beyond the keeper's body when stretching out. */
export const ARM_REACH = 0.9
/**
 * A keeper close to the shooter spreads themselves, arms and legs out, to
 * block: up to this much more reach (m), fading out by SPREAD_RANGE metres.
 */
const SPREAD = 0.3
const SPREAD_RANGE = 10

/** With the ball in hand, look around for who to roll it to every LOOK_EVERY seconds, plus up to LOOK_SPREAD. */
const LOOK_EVERY = 0.3
const LOOK_SPREAD = 0.2
/** Hold the ball at least this long (s), and roll it out by HOLD_MAX whatever happens. */
const HOLD_MIN = 1
const HOLD_MAX = 4
/** Roll it out to a teammate at least this far away (m), once the pass is at least this likely to get through. */
const RECEIVE_MIN = 6
const SAFE_ENOUGH = 0.85
/** Aim where the teammate will be this far ahead (s), arriving at this speed (m/s). */
const PASS_LEAD = 0.3
const PASS_ARRIVAL = 3.5
/** Spread (rad) of a rolled pass around its line. */
const PASS_ERROR = 0.04
/** Seconds after rolling it out before the keeper could gather it again. */
const RELEASE_RECOVER = 1
/** Where the ball sits in the keeper's hands, ahead of their centre and off the ground (m). */
const HANDS_AHEAD = 0.3
const HANDS_HEIGHT = 1.1

/**
 * Each keeper guards their own goal; the one facing a shot dives for it, and
 * one with the ball in their hands rolls it out to a teammate.
 */
export function keeperSystem(world: Match, dt: number) {
  for (const eid of query(world, [Goalkeeper, Position, Velocity, Facing, Team])) {
    Goalkeeper.recover[eid] = Math.max(0, Goalkeeper.recover[eid] - dt)
    if (world.phase === 'held' && Team.id[eid] === world.possession) {
      holdAndRollOut(world, eid)
      continue
    }
    // Keepers stay square to the ball; their dives are lateral, so they move
    // outside the locomotion model.
    Facing.angle[eid] = Math.atan2(Position.y[world.ball] - Position.y[eid], Position.x[world.ball] - Position.x[eid])
    if (world.phase === 'shot' && eid === world.keeper) dive(world, eid, dt)
    else if (world.phase === 'stopped') {
      const decay = Math.exp(-6 * dt)
      Velocity.x[eid] *= decay
      Velocity.y[eid] *= decay
    } else setPosition(world, eid, dt)
    Position.x[eid] += Velocity.x[eid] * dt
    Position.y[eid] += Velocity.y[eid] * dt
    const limit = GOAL_HALF_WIDTH + POST_OVERRUN
    if (Math.abs(Position.y[eid]) > limit) {
      Position.y[eid] = Math.sign(Position.y[eid]) * limit
      Velocity.y[eid] = 0
    }
  }
}

/**
 * Narrows the angle: stands on the line that splits the angle between the
 * ball and the two posts, further off the goal line the further away the
 * ball is, and further still when the shooter is through on their own.
 */
function setPosition(world: Match, eid: number, dt: number) {
  const ball = world.ball
  const team = Team.id[eid]
  const lineX = ownGoalX(world.pitch, team)
  const bx = Position.x[ball]
  const by = Position.y[ball]
  const distance = Math.hypot(bx - lineX, by)
  // Where the bisector meets the goal line: it splits the goal mouth in the ratio of the distances to the posts.
  const near = Math.hypot(bx - lineX, by - GOAL_HALF_WIDTH)
  const far = Math.hypot(bx - lineX, by + GOAL_HALF_WIDTH)
  const footY = GOAL_HALF_WIDTH - (2 * GOAL_HALF_WIDTH * near) / (near + far)
  const through = distance < ONE_ON_ONE_RANGE && team !== world.possession && !defenderGoalSide(world, team, distance)
  const advance = through
    ? clamp(ONE_ON_ONE_SHARE * distance, ADVANCE_MIN, ONE_ON_ONE_MAX)
    : clamp(ADVANCE_SHARE * distance, ADVANCE_MIN, ADVANCE_MAX)
  const toBall = Math.hypot(bx - lineX, by - footY) || 1
  const step = Math.min(advance, toBall * 0.8)
  const tx = lineX + ((bx - lineX) / toBall) * step
  const ty = clamp(footY + ((by - footY) / toBall) * step, -(GOAL_HALF_WIDTH - 0.3), GOAL_HALF_WIDTH - 0.3)
  const dx = tx - Position.x[eid]
  const dy = ty - Position.y[eid]
  const dist = Math.hypot(dx, dy)
  const speed = Math.min(through ? RUSH_SPEED : SET_SPEED, dist / dt)
  Velocity.x[eid] = dist > 1e-4 ? (dx / dist) * speed : 0
  Velocity.y[eid] = dist > 1e-4 ? (dy / dist) * speed : 0
}

/** Whether any of `team`'s outfielders is nearer their own goal than the ball, `distance` from it, is. */
function defenderGoalSide(world: Match, team: number, distance: number) {
  const lineX = ownGoalX(world.pitch, team)
  return world.teams[team].outfielders.some((eid) => Math.hypot(Position.x[eid] - lineX, Position.y[eid]) < distance - 1)
}

/** How far from their centre (m) `keeper` can stop a shot struck from `shotDistance` metres away from them. */
export function keeperReach(keeper: number, shotDistance: number): number {
  return Body.radius[keeper] + ARM_REACH + SPREAD * Math.max(0, 1 - shotDistance / SPREAD_RANGE)
}

/**
 * How far across (m) `keeper` can get a hand to, `seconds` after they start
 * to dive from standing, against a shot struck `shotDistance` metres away:
 * the ground they cover, plus their reach.
 */
export function diveReach(keeper: number, seconds: number, shotDistance: number): number {
  const t = Math.max(0, seconds)
  const flatOut = DIVE_SPEED / DIVE_ACCEL
  const covered = t < flatOut ? 0.5 * DIVE_ACCEL * t * t : 0.5 * DIVE_SPEED * flatOut + DIVE_SPEED * (t - flatOut)
  return covered + keeperReach(keeper, shotDistance)
}

/** Frozen until the reaction delay runs out, then dive across the line. */
function dive(world: Match, eid: number, dt: number) {
  Velocity.x[eid] = 0
  if (Goalkeeper.reactTimer[eid] > 0) {
    Goalkeeper.reactTimer[eid] -= dt
    Velocity.y[eid] = 0
    return
  }
  const ball = world.ball
  const vx = Velocity.x[ball]
  // Time until the ball reaches the keeper's line, if it's coming towards it.
  const t = vx !== 0 ? Math.max(0, (Position.x[eid] - Position.x[ball]) / vx) : 0
  const predictedY = Position.y[ball] + Velocity.y[ball] * t
  const desired = clamp((predictedY - Position.y[eid]) * 10, -DIVE_SPEED, DIVE_SPEED)
  const change = clamp(desired - Velocity.y[eid], -DIVE_ACCEL * dt, DIVE_ACCEL * dt)
  Velocity.y[eid] += change
}

/**
 * Stands with the ball in hands, facing the teammate it would be safest to
 * roll it to, and rolls it out once that teammate is far enough away and the
 * pass would surely get through. They judge that by looking around a few
 * times a second, not continuously.
 */
function holdAndRollOut(world: Match, eid: number) {
  const { ball } = world
  if (world.time >= Goalkeeper.nextLook[eid]) {
    Goalkeeper.nextLook[eid] = world.time + LOOK_EVERY + world.rng() * LOOK_SPREAD
    const look = bestReceiver(world, eid, Position.x[eid], Position.y[eid])
    Goalkeeper.receiver[eid] = look.receiver
    Goalkeeper.safety[eid] = look.safety
  }
  const receiver = Goalkeeper.receiver[eid]
  const safety = Goalkeeper.safety[eid]
  setVec(Velocity, eid, 0, 0, 0)
  Facing.angle[eid] = Math.atan2(Position.y[receiver] - Position.y[eid], Position.x[receiver] - Position.x[eid])
  const fx = Math.cos(Facing.angle[eid])
  const fy = Math.sin(Facing.angle[eid])
  setVec(Position, ball, Position.x[eid] + fx * HANDS_AHEAD, Position.y[eid] + fy * HANDS_AHEAD, HANDS_HEIGHT)
  setVec(Velocity, ball, 0, 0, 0)
  if (world.phaseTime < HOLD_MIN) return
  if (safety < SAFE_ENOUGH && world.phaseTime < HOLD_MAX) return
  passToOutfielder(world, eid, receiver, Position.x[eid], Position.y[eid])
}

/**
 * The keeper's teammate it's safest to play to from (fromX, fromY), and how
 * safe that pass is. Teammates too close to be worth rolling it to count as
 * unsafe.
 */
export function bestReceiver(world: Match, keeper: number, fromX: number, fromY: number) {
  const team = Team.id[keeper]
  let receiver = world.teams[team].outfielders[0]
  let safety = -1
  for (const eid of world.teams[team].outfielders) {
    const { x, y } = passTarget(eid)
    const distance = Math.hypot(x - fromX, y - fromY)
    const s = distance < RECEIVE_MIN ? 0 : passSafety(world, team, fromX, fromY, x, y, rollSpeedFor(distance, PASS_ARRIVAL))
    if (s > safety) {
      receiver = eid
      safety = s
    }
  }
  return { receiver, safety }
}

/** Where to aim a pass to `receiver`: a little ahead of where they're running. */
function passTarget(receiver: number) {
  return { x: Position.x[receiver] + Velocity.x[receiver] * PASS_LEAD, y: Position.y[receiver] + Velocity.y[receiver] * PASS_LEAD }
}

/**
 * Plays the ball along the ground from (fromX, fromY) to `receiver`, weighted
 * to reach them at a comfortable pace, and resumes play with them on it.
 * Used for rolling it out of the hands and for kicking a back-pass first time.
 */
export function passToOutfielder(world: Match, keeper: number, receiver: number, fromX: number, fromY: number) {
  // Keepers are never offside, so this only judges their teammates.
  playBall(world, keeper)
  const { ball, rng } = world
  const { x, y } = passTarget(receiver)
  const angle = Math.atan2(y - fromY, x - fromX) + gaussian(rng) * PASS_ERROR
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const start = 0.5
  const speed = rollSpeedFor(Math.max(0, Math.hypot(x - fromX, y - fromY) - start), PASS_ARRIVAL)
  setVec(Position, ball, fromX + dx * start, fromY + dy * start, BALL_RADIUS)
  setVec(Velocity, ball, dx * speed, dy * speed, 0)
  Goalkeeper.recover[keeper] = RELEASE_RECOVER
  world.lastTouchedBy = keeper
  world.lastTouchDeliberate = true
  world.lastTouch = null
  world.shot = null
  // A new ball from the keeper, even to the player an earlier pass was meant for.
  world.pass = null
  handOver(world, receiver)
  setPhase(world, 'play')
  cue(world, { kind: 'passStruck', passer: keeper, receiver })
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

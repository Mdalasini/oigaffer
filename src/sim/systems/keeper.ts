import { query } from 'bitecs'
import { Facing, Goalkeeper, Position, Team, Velocity } from '../components'
import { BALL_RADIUS, GOAL_HALF_WIDTH } from '../constants'
import { distanceToSegment } from '../geometry'
import { setPhase, setVec, type Match } from '../match'
import { rollSpeedFor } from '../passing'
import { gaussian } from '../rng'
import { ownGoalX } from '../teams'

/** How far off the line the keeper comes to narrow the angle. */
const ADVANCE = 1.5
const SET_SPEED = 4
const DIVE_SPEED = 7.5
const DIVE_ACCEL = 26
/** Furthest the keeper's centre goes beyond a post. */
const POST_OVERRUN = 0.4

/** Hold the ball at least this long (s), and roll it out by HOLD_MAX whatever happens. */
const HOLD_MIN = 1
const HOLD_MAX = 4
/** Roll it out once the teammate is this far away (m), with the opponent this far off the line of the pass. */
const RECEIVE_MIN = 6
const LANE_CLEARANCE = 2.5
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
 * one with the ball in their hands rolls it out to their outfielder.
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

/** Stand just off the line, between the ball and the centre of goal. */
function setPosition(world: Match, eid: number, dt: number) {
  const ball = world.ball
  const lineX = ownGoalX(Team.id[eid])
  const bx = Position.x[ball] - lineX
  const by = Position.y[ball]
  const len = Math.hypot(bx, by) || 1
  const tx = lineX + (bx / len) * ADVANCE
  const ty = clamp((by / len) * ADVANCE * 2, -(GOAL_HALF_WIDTH - 0.5), GOAL_HALF_WIDTH - 0.5)
  const dx = tx - Position.x[eid]
  const dy = ty - Position.y[eid]
  const dist = Math.hypot(dx, dy)
  const speed = Math.min(SET_SPEED, dist / dt)
  Velocity.x[eid] = dist > 1e-4 ? (dx / dist) * speed : 0
  Velocity.y[eid] = dist > 1e-4 ? (dy / dist) * speed : 0
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
 * Stands with the ball in hands, facing their outfielder, and once they've
 * found space away from the opponent rolls it out to where they're heading.
 */
function holdAndRollOut(world: Match, eid: number) {
  const { ball } = world
  const receiver = world.teams[Team.id[eid]].outfielders[0]
  const opponent = world.presser
  setVec(Velocity, eid, 0, 0, 0)
  Facing.angle[eid] = Math.atan2(Position.y[receiver] - Position.y[eid], Position.x[receiver] - Position.x[eid])
  const fx = Math.cos(Facing.angle[eid])
  const fy = Math.sin(Facing.angle[eid])
  setVec(Position, ball, Position.x[eid] + fx * HANDS_AHEAD, Position.y[eid] + fy * HANDS_AHEAD, HANDS_HEIGHT)
  setVec(Velocity, ball, 0, 0, 0)
  if (world.phaseTime < HOLD_MIN) return

  const { x, y } = passTarget(receiver)
  const distance = Math.hypot(x - Position.x[eid], y - Position.y[eid])
  const lane = distanceToSegment(Position.x[opponent], Position.y[opponent], Position.x[eid], Position.y[eid], x, y)
  if ((distance < RECEIVE_MIN || lane < LANE_CLEARANCE) && world.phaseTime < HOLD_MAX) return
  passToOutfielder(world, eid, Position.x[eid], Position.y[eid])
}

/** Where to aim a pass to `receiver`: a little ahead of where they're running. */
function passTarget(receiver: number) {
  return { x: Position.x[receiver] + Velocity.x[receiver] * PASS_LEAD, y: Position.y[receiver] + Velocity.y[receiver] * PASS_LEAD }
}

/**
 * Plays the ball along the ground from (fromX, fromY) to the keeper's own
 * outfielder, weighted to reach them at a comfortable pace, and resumes play.
 * Used for rolling it out of the hands and for kicking a back-pass first time.
 */
export function passToOutfielder(world: Match, keeper: number, fromX: number, fromY: number) {
  const { ball, rng } = world
  const receiver = world.teams[Team.id[keeper]].outfielders[0]
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
  setPhase(world, 'play')
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

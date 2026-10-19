import { Dribbler, Facing, MoveIntent, Outfielder, Passer, Physical, Position, TouchStyle, Velocity } from '../components'
import { BALL_RADIUS } from '../constants'
import { controlTime, firstTouchError, topSpeed } from '../grades'
import type { Match } from '../match'
import { rollDistanceIn, rollStopTime } from '../passing'
import { playBall } from '../offside'
import { seenX, seenY } from '../perception'
import { gaussian } from '../rng'
import { arrivalTime } from '../space/arrival'
import { HEADER_HEIGHT } from '../space/control'
import { attackedGoalX, opponent } from '../teams'
import { ballAtFeet, canPlayBall, touchAngle, withinAerialReach } from '../touch'
import { airborne, dropPoint, MEET_HEIGHT } from '../flight'
import { aerialControlChance } from '../grades'
import { cue } from '../cues'
import { playFirstTime } from './carrier'
import { claimingKeeper } from './keeper'
import { RETURN_WINDOW } from '../playmaking'
import { atan2, cos, hypot, sin } from '../fmath'

/** How close (m) to the ball's path the receiver needs to be to take it. */
const RECEIVE_REACH = 0.5
/** Steps (s) along the ball's roll when looking for where to meet it, and how far ahead to look. */
const LOOK_STEP = 0.1
const LOOK_AHEAD = 4
/** Fastest (m/s) a receiver moves towards a ball coming at them. */
const STEP_IN = 1.5
/** A through ball's receiver meets it no more than this far (m) short of where it was aimed. */
const THROUGH_SLACK = 2
/** A pass not taken within this long (s) has gone astray: the ball is anyone's. */
const PASS_EXPIRY = 6
/** A first touch sets the ball moving this much faster than the receiver (m/s), the way they want to go: under control, not dead. */
const SET_PUSH = 0.8
/** Opponents within this distance (m) make the receiver take it away from them. */
const PRESSURE_RANGE = 5
/**
 * A dropping ball coming at them at up to EASY_DROP m/s is as easy to bring
 * down as it gets; each m/s faster costs DROP_PACE_COST of that chance, down
 * to FASTEST_DROP_SHARE of it.
 */
const EASY_DROP = 10
const DROP_PACE_COST = 0.012
const FASTEST_DROP_SHARE = 0.6
/** A dropping ball is set this many times less truly than one along the ground, and this much later (s). */
const AERIAL_TOUCH_ERROR = 1.5
const AERIAL_SETTLE = 0.25
/** Having jumped with an opponent for it, a player brings the ball down this share as often. */
const CONTESTED_SHARE = 0.5
/** A dropping ball that gets away goes off at between these paces (m/s), within about this angle (rad) of the way it came, and up to this fast (m/s) upwards. */
const SPILL_SLOWEST = 2.5
const SPILL_FASTEST = 6
const SPILL_SPREAD = 0.8
const SPILL_UP = 2

/**
 * The receiver of a pass goes to meet it: they head for the first point on
 * the ball's path they can get to before it does, at the pace that gets them
 * there in time, and on a through ball no sooner than where it was aimed.
 * They face the ball if it's close or they're moving slowly.
 */
export function meetTheBall(world: Match, eid: number) {
  const ball = world.ball
  // A ball in the air they attack where it comes down, as anyone going for it would.
  const drop = world.pass?.lofted ? dropPoint(world, MEET_HEIGHT) : null
  if (drop) {
    const dx = drop.x - Position.x[eid]
    const dy = drop.y - Position.y[eid]
    const distance = hypot(dx, dy)
    const pace = distance < 0.2 ? 0 : Math.min(topSpeed(Physical.pace[eid]), distance / Math.max(drop.t, 0.15))
    MoveIntent.vx[eid] = distance > 0 ? (dx / distance) * pace : 0
    MoveIntent.vy[eid] = distance > 0 ? (dy / distance) * pace : 0
    const near = distance < 4 || pace < 3
    MoveIntent.faceX[eid] = near ? Position.x[ball] - Position.x[eid] : 0
    MoveIntent.faceY[eid] = near ? Position.y[ball] - Position.y[eid] : 0
    Dribbler.style[eid] = TouchStyle.None
    return
  }
  const speed = hypot(Velocity.x[ball], Velocity.y[ball])
  let tx = Position.x[ball]
  let ty = Position.y[ball]
  let meet = 0
  if (speed > 0.3) {
    const ux = Velocity.x[ball] / speed
    const uy = Velocity.y[ball] / speed
    const stop = rollStopTime(speed)
    meet = Math.min(stop, LOOK_AHEAD)
    // A through ball is run onto where it was put, not cut off on its way there.
    const pass = world.pass
    const earliest = pass?.kind === 'through' ? (pass.x - Position.x[ball]) * ux + (pass.y - Position.y[ball]) * uy - THROUGH_SLACK : 0
    for (let t = LOOK_STEP; t <= Math.min(stop, LOOK_AHEAD); t += LOOK_STEP) {
      const s = rollDistanceIn(speed, t)
      if (s < earliest) continue
      const x = Position.x[ball] + ux * s
      const y = Position.y[ball] + uy * s
      if (arrivalTime(world, eid, x, y, RECEIVE_REACH) <= t) {
        meet = t
        break
      }
    }
    const s = rollDistanceIn(speed, meet)
    tx = Position.x[ball] + ux * s
    ty = Position.y[ball] + uy * s
  }
  const dx = tx - Position.x[eid]
  const dy = ty - Position.y[eid]
  const distance = hypot(dx, dy)
  let pace = distance < 0.2 ? 0 : Math.min(topSpeed(Physical.pace[eid]), distance / Math.max(meet, 0.15))
  // Stepping towards a ball coming at them, they only step in, so they're set when it arrives.
  if (speed > 0.3 && distance > 0 && (dx * Velocity.x[ball] + dy * Velocity.y[ball]) / (distance * speed) < -0.5) pace = Math.min(pace, STEP_IN)
  MoveIntent.vx[eid] = distance > 0 ? (dx / distance) * pace : 0
  MoveIntent.vy[eid] = distance > 0 ? (dy / distance) * pace : 0
  const near = distance < 4 || pace < 3
  MoveIntent.faceX[eid] = near ? Position.x[ball] - Position.x[eid] : 0
  MoveIntent.faceY[eid] = near ? Position.y[ball] - Position.y[eid] : 0
  Dribbler.style[eid] = TouchStyle.None
}

/**
 * The receiver's first touch, once the pass reaches them, unless they play
 * it on first time (see `playFirstTime`). They cushion it,
 * however hard it came, and set it for their next action: towards goal,
 * away from anyone closing them down, and within what their body shape
 * allows, moving with them if they're running onto it. A better first touch
 * sets it a little truer, and is ready to play it again sooner.
 */
export function receiveSystem(world: Match, _dt: number) {
  const pass = world.pass
  if (!pass || world.phase !== 'play') return
  if (world.time - pass.time > PASS_EXPIRY) {
    world.pass = null
    return
  }
  const eid = pass.to
  const ball = world.ball
  if (!canPlayBall(world, eid)) return
  // A lofted pass still in the air is cushioned down off the head, chest or thigh as it drops, or as it bounces up at them.
  const dropping = pass.lofted && airborne(world)
  if (dropping && claimingKeeper(world) !== -1) return
  if (dropping ? !withinAerialReach(eid, ball, HEADER_HEIGHT) && !ballAtFeet(eid, ball) : !ballAtFeet(eid, ball)) return
  if (!playBall(world, eid)) return
  received(world, eid, pass.from)
  if (dropping) return controlDroppingBall(world, eid)
  if (playFirstTime(world, eid)) return
  firstTouch(world, eid, 1, 0)
}

/** `eid` has the pass from `from`: it counts as completed, and as part of any run of passes between the two of them. */
export function received(world: Match, eid: number, from: number) {
  world.stats[world.possession].completed++
  world.pass = null
  // Giving it straight back to whoever had just passed it adds to the run of passes between the two of them.
  const back = Passer.receivedFrom[from] === eid && world.time - Passer.receivedAt[from] <= RETURN_WINDOW
  Passer.exchanges[eid] = back ? Passer.exchanges[from] + 1 : 1
  Passer.receivedFrom[eid] = from
  Passer.receivedAt[eid] = world.time
}

/**
 * Bringing down a ball that's dropping on them: harder than taking one
 * along the ground, the harder the faster it comes, and harder still having
 * just jumped with someone for it (`contested`). With a good first touch
 * it's under control, a little less truly set and a little later than a
 * ground pass would be; otherwise it gets away from them, loose for
 * whoever is first to it.
 */
export function controlDroppingBall(world: Match, eid: number, contested = false) {
  const ball = world.ball
  const { rng } = world
  const rx = Velocity.x[ball] - Velocity.x[eid]
  const ry = Velocity.y[ball] - Velocity.y[eid]
  const pace = hypot(hypot(rx, ry), Velocity.z[ball])
  const harder = Math.max(FASTEST_DROP_SHARE, 1 - Math.max(0, pace - EASY_DROP) * DROP_PACE_COST)
  if (rng() < aerialControlChance(Outfielder.firstTouch[eid]) * harder * (contested ? CONTESTED_SHARE : 1)) return firstTouch(world, eid, AERIAL_TOUCH_ERROR, AERIAL_SETTLE)
  // It comes off them the way it was going, more or less, at a pace they can't stay with at once.
  const angle = atan2(ry, rx) + gaussian(rng) * SPILL_SPREAD
  const speed = SPILL_SLOWEST + rng() * (SPILL_FASTEST - SPILL_SLOWEST)
  Velocity.x[ball] = Velocity.x[eid] + cos(angle) * speed
  Velocity.y[ball] = Velocity.y[eid] + sin(angle) * speed
  Velocity.z[ball] = SPILL_UP * rng()
  Dribbler.cooldown[eid] = AERIAL_SETTLE
  world.lastTouch = null
  world.lastTouchedBy = eid
  world.lastTouchDeliberate = false
  cue(world, { kind: 'loose', player: eid })
}

/**
 * The receiver's first touch: they cushion it, however hard it came, and set
 * it for their next action, its direction off by `errorScale` times their
 * usual error, and ready to play again `settle` seconds later than usual.
 */
function firstTouch(world: Match, eid: number, errorScale: number, settle: number) {
  const ball = world.ball
  const firstTouch = Outfielder.firstTouch[eid]
  const want = touchDirection(world, eid)
  const angle = touchAngle(eid, TouchStyle.Small, want.x, want.y) + gaussian(world.rng) * firstTouchError(firstTouch) * errorScale
  Velocity.x[ball] = Velocity.x[eid] + cos(angle) * SET_PUSH
  Velocity.y[ball] = Velocity.y[eid] + sin(angle) * SET_PUSH
  Velocity.z[ball] = 0
  Position.z[ball] = BALL_RADIUS

  Dribbler.cooldown[eid] = controlTime(firstTouch) + settle
  world.lastTouch = { by: eid, style: TouchStyle.Small, time: world.time, x: Position.x[ball], y: Position.y[ball] }
  world.lastTouchedBy = eid
  world.lastTouchDeliberate = true
}

/**
 * Where the receiver wants their first touch to take the ball: towards the
 * goal they attack, turned away from the nearest opponent if one is close.
 * That's the nearest they know of: one coming from behind that they haven't
 * scanned for is taken where they last saw him, and the touch may go
 * straight into him.
 */
function touchDirection(world: Match, eid: number) {
  const goalX = attackedGoalX(world.pitch, world.possession)
  const L = world.pitch.halfLength
  let x = goalX - Position.x[eid]
  let y = (-Position.y[eid] * L) / Math.max(Math.abs(goalX - Position.x[eid]), L)
  const length = hypot(x, y) || 1
  x /= length
  y /= length
  let nearest = -1
  let gap = PRESSURE_RANGE
  let nx = 0
  let ny = 0
  for (const other of world.teams[opponent(world.possession)].outfielders) {
    const ox = seenX(world, eid, other)
    const oy = seenY(world, eid, other)
    const d = hypot(ox - Position.x[eid], oy - Position.y[eid])
    if (d < gap) {
      nearest = other
      gap = d
      nx = ox
      ny = oy
    }
  }
  if (nearest !== -1) {
    // Lean away from them, the more the closer they are.
    const away = 1 - gap / PRESSURE_RANGE
    x += ((Position.x[eid] - nx) / gap) * away
    y += ((Position.y[eid] - ny) / gap) * away
  }
  // Keep it on the pitch.
  if (Math.abs(Position.y[eid]) > world.pitch.halfWidth - 2 && Math.sign(y) === Math.sign(Position.y[eid])) y = 0
  const facing = Facing.angle[eid]
  return hypot(x, y) > 1e-6 ? { x, y } : { x: cos(facing), y: sin(facing) }
}

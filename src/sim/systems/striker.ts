import { query } from 'bitecs'
import { angleDelta } from '../angles'
import { Dribbler, Facing, Goalkeeper, MoveIntent, OffBalance, Outfielder, Physical, Position, Shield, TakeOn, TouchStyle, Velocity } from '../components'
import { GOAL_X } from '../constants'
import { closeControlSpeed, reactionDelay, shotSpreadRadius } from '../grades'
import { setPhase, setVec, type Match } from '../match'
import { chooseAim, launchVelocity, sampleShotTarget } from '../shooting'
import { ballAtFeet, canPlayBall, dribble, footDistance } from '../touch'

const SHOT_SPEED = 25
/**
 * Rough distance (m) covered before a large touch is caught up with, at a
 * given running speed: the faster you run, the further the ball goes.
 */
const largeTouchTravel = (speed: number) => 3 + speed * 2.2
/** Only shoot when facing within this angle (rad) of goal. */
const MAX_SHOT_TURN = 1.3
/** Don't shoot if the defender is within this distance (m) of the line to the aim point. */
const LANE_CLEARANCE = 1

/** Start working the defender once they are this close and in the way. */
const TAKE_ON_RANGE = 7
/** Carry the ball at a point this far (m) outside the defender's shoulder... */
const SHOULDER_OFFSET = 1.2
/** ...until this close, then cut across at this angle (rad) off the line to goal. */
const CUT_RANGE = 3
const CUT_ANGLE = 1.2
/** Knock it past at this angle once this far (m) to the side of the defender's body. */
const BURST_ANGLE = 0.5
const BURST_CLEARANCE = 1.1
/** Share of close-control speed used while working the defender, to keep the ball tight. */
const TAKE_ON_PACE = 0.7
/** Chance of selling a dummy the other way first, and how long it's sold for. */
const FEINT_CHANCE = 0.5
const FEINT_TIME = 0.35
/** If the defender mirrors a cut for this long (s, plus up to CHECK_BACK_SPREAD), check back the other way. */
const CHECK_BACK_AFTER = 0.6
const CHECK_BACK_SPREAD = 0.6
/** A beaten defender this close behind is chasing: shoot this much earlier, and run with it. */
const CHASED_WITHIN = 7
const CHASED_SHOOT_EARLIER = 5
/** Shield when the defender is this close (m) and the ball is this tight (m) to the feet. */
const SHIELD_RANGE = 1.4
const SHIELD_CONTROL = 0.9
/** Hold the shield for SHIELD_HOLD plus up to SHIELD_SPREAD seconds, then turn away; not again for SHIELD_REST. */
const SHIELD_HOLD = 0.5
const SHIELD_SPREAD = 0.8
const SHIELD_REST = 1.5
/** Barely move while shielding (m/s). */
const SHIELD_PACE = 1.2

/** The striker's decisions: dribble at goal with touches, then shoot. */
export function strikerSystem(world: Match, dt: number) {
  for (const eid of query(world, [Outfielder, MoveIntent, Dribbler])) {
    MoveIntent.faceX[eid] = 0
    MoveIntent.faceY[eid] = 0
    if (world.phase !== 'approach') {
      MoveIntent.vx[eid] = 0
      MoveIntent.vy[eid] = 0
      Dribbler.style[eid] = TouchStyle.None
      continue
    }

    const ball = world.ball
    const toGoalX = GOAL_X - Position.x[ball]
    const toGoalY = -Position.y[ball]
    const distance = Math.hypot(toGoalX, toGoalY)
    const dirX = toGoalX / distance
    const dirY = toGoalY / distance

    const chased = world.defenderActive && isChased(world, dirX, dirY)
    const shootDistance = world.shootDistance + (chased ? CHASED_SHOOT_EARLIER : 0)
    if (canPlayBall(world, eid) && wantsToShoot(world, eid, distance, shootDistance) && ballAtFeet(eid, ball) && Dribbler.cooldown[eid] === 0) {
      shoot(world, eid)
      continue
    }

    if (world.defenderActive && shield(world, eid, dirX, dirY, dt)) continue
    if (world.defenderActive && takeOn(world, eid, dirX, dirY, dt)) continue
    TakeOn.side[eid] = 0

    // Knock it long while the next contact would still come before shooting range,
    // or whenever a beaten defender is chasing.
    const speed = Math.hypot(Velocity.x[eid], Velocity.y[eid])
    const roomToRun = distance - largeTouchTravel(speed) > shootDistance
    const style = roomToRun || chased ? TouchStyle.Large : TouchStyle.Small
    dribble(eid, ball, style, dirX, dirY)
  }
}

function wantsToShoot(world: Match, eid: number, distance: number, shootDistance: number) {
  if (!world.shootRequested && distance > shootDistance) return false
  const facingGoal = Math.atan2(-Position.y[eid], GOAL_X - Position.x[eid])
  if (Math.abs(angleDelta(Facing.angle[eid], facingGoal)) > MAX_SHOT_TURN) return false
  return world.shootRequested || !world.defenderActive || laneClear(world)
}

/** Whether a defender who has been beaten is close behind. */
function isChased(world: Match, gx: number, gy: number) {
  const rx = Position.x[world.defender] - Position.x[world.ball]
  const ry = Position.y[world.defender] - Position.y[world.ball]
  return rx * gx + ry * gy < -0.5 && Math.hypot(rx, ry) < CHASED_WITHIN
}

/** Whether the defender is out of the way of a shot at this attack's aim point. */
function laneClear(world: Match) {
  const { ball, defender, keeper } = world
  const aim = chooseAim(Position.y[ball], Position.y[keeper], world.aimHigh)
  return distanceToSegment(
    Position.x[defender],
    Position.y[defender],
    Position.x[ball],
    Position.y[ball],
    GOAL_X,
    aim.y,
  ) > LANE_CLEARANCE
}

/**
 * With the defender tight and the ball at the feet, put the body between them
 * and the ball: turn away, roll it under the sole, and hold them off for a
 * moment before spinning away from them. Returns false when not shielding.
 */
function shield(world: Match, eid: number, gx: number, gy: number, dt: number): boolean {
  const { ball, defender, rng } = world
  Shield.timer[eid] -= dt
  const awayX = Position.x[eid] - Position.x[defender]
  const awayY = Position.y[eid] - Position.y[defender]
  const gap = Math.hypot(awayX, awayY)
  // How far the ball sits towards the defender's side of the striker's body:
  // shielding only works with the ball on the far side.
  const ballTowardDefender = -((Position.x[ball] - Position.x[eid]) * awayX + (Position.y[ball] - Position.y[eid]) * awayY) / (gap || 1)

  if (!Shield.active[eid]) {
    const goalSide = (Position.x[defender] - Position.x[ball]) * gx + (Position.y[defender] - Position.y[ball]) * gy > -0.3
    const tight = footDistance(eid, ball) < SHIELD_CONTROL
    if (Shield.timer[eid] > 0 || gap > SHIELD_RANGE || !goalSide || !tight || ballTowardDefender > 0.1) return false
    Shield.active[eid] = 1
    Shield.timer[eid] = SHIELD_HOLD + rng() * SHIELD_SPREAD
  }

  const exposed = ballTowardDefender > 0.3
  if (Shield.timer[eid] <= 0 || gap > SHIELD_RANGE + 0.8 || OffBalance.timer[defender] > 0 || exposed) {
    // Turn away from the side the defender is on and take them on from there.
    Shield.active[eid] = 0
    Shield.timer[eid] = SHIELD_REST
    const lateral = -(Position.x[defender] - Position.x[ball]) * gy + (Position.y[defender] - Position.y[ball]) * gx
    beginTakeOn(world, eid, lateral > 0 ? -1 : 1, false)
    return false
  }

  const nx = awayX / (gap || 1)
  const ny = awayY / (gap || 1)
  dribble(eid, ball, TouchStyle.Shield, nx, ny, SHIELD_PACE)
  MoveIntent.faceX[eid] = nx
  MoveIntent.faceY[eid] = ny
  return true
}

/**
 * Beating the defender: carry the ball at their outside shoulder, cut across
 * them up close (sometimes after a dummy the other way), and once clear of
 * their body knock it past and run. Returns false when the defender isn't in
 * the way.
 */
function takeOn(world: Match, eid: number, gx: number, gy: number, dt: number): boolean {
  const { ball, defender, rng } = world
  const rx = Position.x[defender] - Position.x[ball]
  const ry = Position.y[defender] - Position.y[ball]
  // Defender's position along the line to goal, and to its left (+) or right (-).
  const along = rx * gx + ry * gy
  const lateral = -rx * gy + ry * gx
  const distance = Math.hypot(rx, ry)
  if (along < -0.5 || distance > TAKE_ON_RANGE || Math.abs(lateral) > 4) return false

  if (TakeOn.side[eid] === 0) {
    // Go round the side the defender is leaning away from.
    const side = lateral > 0.2 ? -1 : lateral < -0.2 ? 1 : rng() < 0.5 ? 1 : -1
    beginTakeOn(world, eid, side, rng() < FEINT_CHANCE)
  }
  let side = TakeOn.side[eid]
  // How far the defender sits off to the far side of our path: positive once we're getting round them.
  const clearance = -lateral * side
  const pace = closeControlSpeed(Physical.pace[eid], Outfielder.dribbling[eid]) * TAKE_ON_PACE

  if (along < 0.3 || (distance < CUT_RANGE && clearance > BURST_CLEARANCE)) {
    const [x, y] = rotate(gx, gy, side * BURST_ANGLE)
    dribble(eid, ball, TouchStyle.Large, x, y)
  } else if (distance < CUT_RANGE) {
    let cutSide = side
    if (TakeOn.feintTimer[eid] > 0) {
      TakeOn.feintTimer[eid] -= dt
      cutSide = -side
    } else {
      TakeOn.checkBackTimer[eid] -= dt
      if (TakeOn.checkBackTimer[eid] <= 0 && clearance < 0.5) {
        // They've mirrored the cut: check back the other way.
        side = -side
        cutSide = side
        TakeOn.side[eid] = side
        TakeOn.checkBackTimer[eid] = CHECK_BACK_AFTER + rng() * CHECK_BACK_SPREAD
      }
    }
    const [x, y] = rotate(gx, gy, cutSide * CUT_ANGLE)
    dribble(eid, ball, TouchStyle.Small, x, y, pace)
  } else {
    const tx = rx - gy * side * SHOULDER_OFFSET
    const ty = ry + gx * side * SHOULDER_OFFSET
    const len = Math.hypot(tx, ty)
    dribble(eid, ball, TouchStyle.Small, tx / len, ty / len, pace)
  }
  return true
}

/** Commits to going round the defender on `side`, with or without a dummy first. */
function beginTakeOn(world: Match, eid: number, side: number, dummy: boolean) {
  TakeOn.side[eid] = side
  TakeOn.feintTimer[eid] = dummy ? FEINT_TIME : 0
  TakeOn.checkBackTimer[eid] = CHECK_BACK_AFTER + world.rng() * CHECK_BACK_SPREAD
}

const rotate = (x: number, y: number, a: number): [number, number] => [
  x * Math.cos(a) - y * Math.sin(a),
  x * Math.sin(a) + y * Math.cos(a),
]

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

function shoot(world: Match, striker: number) {
  const { ball, keeper } = world
  const from = { x: Position.x[ball], y: Position.y[ball], z: Position.z[ball] }
  const aim = chooseAim(from.y, Position.y[keeper], world.aimHigh)
  const radius = shotSpreadRadius(Outfielder.shooting[striker])
  const target = sampleShotTarget(world.rng, aim, radius)
  const v = launchVelocity(from, target, SHOT_SPEED)
  setVec(Velocity, ball, v.x, v.y, v.z)

  Goalkeeper.reactTimer[keeper] = reactionDelay(Goalkeeper.reaction[keeper])
  Dribbler.style[striker] = TouchStyle.None
  world.shot = { origin: from, aim, radius, target, crossing: null }
  world.shootRequested = false
  world.lastTouch = null
  world.stats.shots++
  setPhase(world, 'shot')
}

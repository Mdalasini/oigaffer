import { query } from 'bitecs'
import { angleDelta } from '../angles'
import { Carry, Dribbler, Facing, Passer, Goalkeeper, MoveIntent, OffBalance, OnBall, Outfielder, Physical, Position, Run, Shield, TakeOn, Team, TouchStyle, Velocity } from '../components'
import { distanceToSegment } from '../geometry'
import { closeControlSpeed, passWindup, reactionDelay, topSpeed } from '../grades'
import { rollDistanceIn } from '../passing'
import { cue } from '../cues'
import { setPhase, setVec, type Match } from '../match'
import { playBall } from '../offside'
import { planShot, shotValue } from '../finishing'
import { chooseAim, launchVelocity, sampleShotTarget } from '../shooting'
import { attackedGoalX, opponent } from '../teams'
import { arrivalTime } from '../space/arrival'
import { teamArrival, timeOnBall } from '../space/control'
import { chooseAction, strikePass } from '../playmaking'
import { chooseCarry } from '../carrying'
import { meetTheBall } from './receive'
import { seenX, seenY } from '../perception'
import { ballAtFeet, canPlayBall, dribble, footDistance, roomAhead, touchAngle, TOUCH_SPECS } from '../touch'
import { atan2, cos, hypot, sin } from '../fmath'

/** Seconds after shooting before the shooter can play the ball again. */
const SHOT_RECOVER = 0.4
/**
 * Roughly how far (m) the ball rolls from a large touch before `eid` can
 * play it again: struck a stride's worth faster than they're running, it
 * runs on until they've run it down at full pace, and they can't touch it
 * again before the touch has cooled down anyway.
 */
export function largeTouchTravel(eid: number): number {
  const spec = TOUCH_SPECS[TouchStyle.Large]
  const ball = hypot(Velocity.x[eid], Velocity.y[eid]) + spec.push
  const run = topSpeed(Physical.pace[eid])
  for (let t = spec.cooldown; t < CATCH_WITHIN; t += CATCH_STEP) {
    const rolled = rollDistanceIn(ball, t)
    // It's played as it comes into reach, so it starts out as far ahead of the foot as it's caught.
    if (run * t >= rolled) return rolled
  }
  return rollDistanceIn(ball, CATCH_WITHIN)
}
/** Steps (s) along a large touch's roll when looking for where it's caught, and how far ahead to look. */
const CATCH_STEP = 0.05
const CATCH_WITHIN = 3
/** Spare room (m) beyond a large touch's run before the line. */
const LARGE_TOUCH_MARGIN = 3
/**
 * An opponent who'd get within CONTEST_REACH (m) of where a large touch is
 * next played less than this long (s) after the carrier would nick it: they
 * keep it close instead. The keeper coming off their line counts.
 */
const LARGE_TOUCH_SAFETY = 0.3
const CONTEST_REACH = 1
/** A carry this close to straight at goal (cosine of the angle) counts as heading for it. */
const FORWARD_CARRY = 0.7
/** Within this distance (m) of a touchline, take defenders on the infield side. */
const TOUCHLINE_MARGIN = 5
/** Nobody shoots with less than this chance of scoring: from further out it's a clearance, not a shot. */
const MIN_CHANCE = 0.02
/** Only someone with less than this long (s) before they're closed down plays a pass on first time. */
const FIRST_TIME_WHEN = 1
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
const CHASED_SHOOT_EARLIER = 3
/** Shield when the defender is this close (m) and the ball is this tight (m) to the feet. */
const SHIELD_RANGE = 1.4
const SHIELD_CONTROL = 0.9
/** Hold the shield for SHIELD_HOLD plus up to SHIELD_SPREAD seconds, then turn away; not again for SHIELD_REST. */
const SHIELD_HOLD = 0.5
const SHIELD_SPREAD = 0.8
const SHIELD_REST = 1.5
/** Seconds a spin away from a shield is seen through before the carrier rethinks. */
const SPIN_COMMIT = 0.6
/** Barely move while shielding (m/s). */
const SHIELD_PACE = 1.2

/** The carrier's decisions: dribble at goal with touches, then shoot. */
export function carrierSystem(world: Match, dt: number) {
  // A pass being wound up is off if someone else has the ball, or play has stopped.
  if (world.windup && (world.windup.carrier !== world.carrier || world.phase !== 'play')) cancelWindup(world)
  for (const eid of query(world, [OnBall, Outfielder, MoveIntent, Dribbler])) {
    MoveIntent.faceX[eid] = 0
    MoveIntent.faceY[eid] = 0
    // With a keeper holding the ball, everyone is off it.
    if (world.phase === 'held') continue
    if (world.pass?.to === eid && world.phase === 'play') {
      // A runner who has read the pass late hasn't gone yet: they carry on as they were.
      if (world.time < Run.burstAt[eid]) {
        MoveIntent.vx[eid] = Velocity.x[eid]
        MoveIntent.vy[eid] = Velocity.y[eid]
      } else meetTheBall(world, eid)
      continue
    }
    if (world.phase !== 'play') {
      MoveIntent.vx[eid] = 0
      MoveIntent.vy[eid] = 0
      Dribbler.style[eid] = TouchStyle.None
      continue
    }

    const ball = world.ball
    const goalX = attackedGoalX(world.pitch, Team.id[eid])
    const toGoalX = goalX - Position.x[ball]
    const toGoalY = -Position.y[ball]
    const distance = hypot(toGoalX, toGoalY)
    const dirX = toGoalX / distance
    const dirY = toGoalY / distance

    const chased = isChased(world, dirX, dirY)
    const shootDistance = world.shootDistance + (chased ? CHASED_SHOOT_EARLIER : 0)
    if (canPlayBall(world, eid) && wantsToShoot(world, eid, goalX) && ballAtFeet(eid, ball) && Dribbler.cooldown[eid] === 0) {
      world.onDecision?.(eid, 'shoots: asked to from outside (Space)')
      shoot(world, eid, goalX)
      continue
    }

    // Shaping to pass: no more touches while they set themselves, then strike if the ball is still there.
    const windup = world.windup
    if (windup && windup.carrier === eid) {
      if (world.time < windup.at) {
        setUpPass(eid, ball, windup.option.x, windup.option.y)
        continue
      }
      if (canPlayBall(world, eid) && ballAtFeet(eid, ball)) {
        world.windup = null
        strikePass(world, eid, windup.option)
        continue
      }
      cancelWindup(world)
    }

    if (canPlayBall(world, eid) && ballAtFeet(eid, ball) && Dribbler.cooldown[eid] === 0) {
      const chance = shotOn(world, eid, goalX) ? shotValue(world, eid) : 0
      const choice = chooseAction(world, eid, chance >= MIN_CHANCE ? chance : null)
      if (choice === 'shoot') {
        shoot(world, eid, goalX)
        continue
      }
      const pass = choice
      if (pass) {
        const windup = passWindup(Outfielder.passing[eid])
        world.windup = { carrier: eid, option: pass, at: world.time + windup }
        cue(world, { kind: 'passShaped', passer: eid, option: pass, windup })
        setUpPass(eid, ball, pass.x, pass.y)
        continue
      }
    }

    chooseCarry(world, eid)
    if (shield(world, eid, dirX, dirY, dt)) continue
    if (Carry.takeOn[eid] && takeOn(world, eid, dirX, dirY, dt)) continue
    TakeOn.side[eid] = 0

    // Heading for goal, knock it on while the next contact would still come before shooting range,
    // or whenever a beaten defender is chasing.
    const cx = Carry.dirX[eid]
    const cy = Carry.dirY[eid]
    const roomToRun = distance - largeTouchTravel(eid) > shootDistance
    const forward = cx * dirX + cy * dirY > FORWARD_CARRY
    const style = forward && (roomToRun || chased) ? TouchStyle.Large : TouchStyle.Small
    carry(world, eid, ball, style, cx, cy)
  }
}

/**
 * A pass has just reached `eid`. Closed down as it arrives, they may play it
 * on first time, with no touch to control it: a pass or a shot, chosen just
 * as they would with the ball at their feet, and struck at once, a little
 * less truly than a ball they've set. With time on the ball, or nothing
 * better on, they control it instead. Returns whether they played it.
 */
export function playFirstTime(world: Match, eid: number): boolean {
  if (timeOnBall(world, eid, eid) > FIRST_TIME_WHEN) return false
  const goalX = attackedGoalX(world.pitch, Team.id[eid])
  const chance = shotOn(world, eid, goalX) ? shotValue(world, eid) : 0
  Passer.nextLook[eid] = 0
  const choice = chooseAction(world, eid, chance >= MIN_CHANCE ? chance : null)
  if (choice === 'shoot') {
    shoot(world, eid, goalX)
    return true
  }
  if (!choice) return false
  cue(world, { kind: 'passShaped', passer: eid, option: choice, windup: 0 })
  strikePass(world, eid, choice, true)
  return true
}

/** Whether a shot is on at all: facing near enough to goal, with a clear sight of it, and not straight from an indirect free kick. */
function shotOn(world: Match, eid: number, goalX: number) {
  if (world.indirectTaker === eid) return false
  const facingGoal = atan2(-Position.y[eid], goalX - Position.x[eid])
  return Math.abs(angleDelta(Facing.angle[eid], facingGoal)) <= MAX_SHOT_TURN && laneClear(world, goalX, eid)
}

/** Whoever has the ball shoots on request, if they're facing near enough to goal. */
function wantsToShoot(world: Match, eid: number, goalX: number) {
  if (!world.shootRequested) return false
  const facingGoal = atan2(-Position.y[eid], goalX - Position.x[eid])
  return Math.abs(angleDelta(Facing.angle[eid], facingGoal)) <= MAX_SHOT_TURN
}

/** Calls off a pass being wound up. */
function cancelWindup(world: Match) {
  if (world.windup) cue(world, { kind: 'passCalledOff', option: world.windup.option })
  world.windup = null
}

/** Winding up a pass: stay with the ball without touching it, turning towards where it's going. */
function setUpPass(eid: number, ball: number, x: number, y: number) {
  Dribbler.style[eid] = TouchStyle.None
  MoveIntent.vx[eid] = Velocity.x[ball]
  MoveIntent.vy[eid] = Velocity.y[ball]
  MoveIntent.faceX[eid] = x - Position.x[ball]
  MoveIntent.faceY[eid] = y - Position.y[ball]
}

/** Whether a defender who has been beaten is close behind. */
function isChased(world: Match, gx: number, gy: number) {
  const rx = Position.x[world.presser] - Position.x[world.ball]
  const ry = Position.y[world.presser] - Position.y[world.ball]
  return rx * gx + ry * gy < -0.5 && hypot(rx, ry) < CHASED_WITHIN
}

/**
 * Whether every other outfielder, either side's, is out of the way of a shot
 * at this attack's aim point, as `by` reckons where they and the keeper are.
 */
export function laneClear(world: Match, goalX: number, by: number) {
  const { ball, keeper, carrier } = world
  const aim = chooseAim(Position.y[ball], seenY(world, by, keeper), world.aimHigh)
  const outfielders = [...world.teams[0].outfielders, ...world.teams[1].outfielders]
  return outfielders.every(
    (eid) => eid === carrier || distanceToSegment(seenX(world, by, eid), seenY(world, by, eid), Position.x[ball], Position.y[ball], goalX, aim.y) > LANE_CLEARANCE,
  )
}

/**
 * With the defender tight and the ball at the feet, put the body between them
 * and the ball: turn away, roll it under the sole, and hold them off for a
 * moment before spinning away from them. Returns false when not shielding.
 */
function shield(world: Match, eid: number, gx: number, gy: number, dt: number): boolean {
  const { ball, presser: defender, rng } = world
  Shield.timer[eid] -= dt
  const awayX = Position.x[eid] - Position.x[defender]
  const awayY = Position.y[eid] - Position.y[defender]
  const gap = hypot(awayX, awayY)
  // How far the ball sits towards the defender's side of the carrier's body:
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
    // Spinning away from them is a take-on of its own, seen through before thinking again.
    Carry.takeOn[eid] = 1
    Carry.nextLook[eid] = world.time + SPIN_COMMIT
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
  const { ball, presser: defender, rng } = world
  const rx = Position.x[defender] - Position.x[ball]
  const ry = Position.y[defender] - Position.y[ball]
  // Defender's position along the line to goal, and to its left (+) or right (-).
  const along = rx * gx + ry * gy
  const lateral = -rx * gy + ry * gx
  const distance = hypot(rx, ry)
  if (along < -0.5 || distance > TAKE_ON_RANGE || Math.abs(lateral) > 4) return false

  if (TakeOn.side[eid] === 0) {
    // Go round the side the defender is leaning away from, or infield when near the touchline.
    const infield = -Math.sign(Position.y[ball]) * Math.sign(gx) || 1
    const nearTouchline = Math.abs(Position.y[ball]) > world.pitch.halfWidth - TOUCHLINE_MARGIN
    const side = nearTouchline ? infield : lateral > 0.2 ? -1 : lateral < -0.2 ? 1 : rng() < 0.5 ? 1 : -1
    beginTakeOn(world, eid, side, rng() < FEINT_CHANCE)
  }
  let side = TakeOn.side[eid]
  // How far the defender sits off to the far side of our path: positive once we're getting round them.
  const clearance = -lateral * side
  const pace = closeControlSpeed(Physical.pace[eid], Outfielder.dribbling[eid]) * TAKE_ON_PACE

  if (along < 0.3 || (distance < CUT_RANGE && clearance > BURST_CLEARANCE)) {
    const [x, y] = rotate(gx, gy, side * BURST_ANGLE)
    carry(world, eid, ball, TouchStyle.Large, x, y)
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
    const len = hypot(tx, ty)
    dribble(eid, ball, TouchStyle.Small, tx / len, ty / len, pace)
  }
  return true
}

/**
 * Dribbles, but only knocks the ball on if, the way the body will send it,
 * it would still be on the pitch when caught up with, and nobody they know
 * of would get to it first; otherwise keeps it close.
 */
function carry(world: Match, eid: number, ball: number, style: TouchStyle, dirX: number, dirY: number) {
  // Only worth weighing up when the touch is about to be played.
  if (style === TouchStyle.Large && Dribbler.cooldown[eid] === 0 && ballAtFeet(eid, ball)) {
    const angle = touchAngle(eid, style, dirX, dirY)
    const dx = cos(angle)
    const dy = sin(angle)
    const travel = largeTouchTravel(eid)
    const x = Position.x[ball] + dx * travel
    const y = Position.y[ball] + dy * travel
    if (
      roomAhead(world.pitch, Position.x[ball], Position.y[ball], dx, dy) < travel + LARGE_TOUCH_MARGIN ||
      teamArrival(world, opponent(Team.id[eid]), x, y, CONTEST_REACH, eid) < arrivalTime(world, eid, x, y, 0, 0, eid) + LARGE_TOUCH_SAFETY
    )
      style = TouchStyle.Small
  }
  dribble(eid, ball, style, dirX, dirY)
}

/** Commits to going round the defender on `side`, with or without a dummy first. */
function beginTakeOn(world: Match, eid: number, side: number, dummy: boolean) {
  TakeOn.side[eid] = side
  TakeOn.feintTimer[eid] = dummy ? FEINT_TIME : 0
  TakeOn.checkBackTimer[eid] = CHECK_BACK_AFTER + world.rng() * CHECK_BACK_SPREAD
}

const rotate = (x: number, y: number, a: number): [number, number] => [
  x * cos(a) - y * sin(a),
  x * sin(a) + y * cos(a),
]

function shoot(world: Match, carrier: number, goalX: number) {
  if (!playBall(world, carrier)) return
  const { ball, keeper } = world
  const from = { x: Position.x[ball], y: Position.y[ball], z: Position.z[ball] }
  const { aim, miss, speed } = planShot(world, carrier)
  // Drawn as a circle that takes in most of where the shot could go.
  const radius = 2 * miss
  const target = sampleShotTarget(world.rng, aim, miss)
  const v = launchVelocity(from, target, speed, goalX)
  setVec(Velocity, ball, v.x, v.y, v.z)

  Goalkeeper.reactTimer[keeper] = reactionDelay(Goalkeeper.reaction[keeper])
  Dribbler.style[carrier] = TouchStyle.None
  Dribbler.cooldown[carrier] = SHOT_RECOVER
  const team = Team.id[carrier]
  world.shot = { team, goalX, origin: from, aim, radius, target, crossing: null }
  world.shootRequested = false
  world.lastTouch = null
  world.lastTouchedBy = carrier
  world.lastTouchDeliberate = true
  world.stats[team].shots++
  setPhase(world, 'shot')
}

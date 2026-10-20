import { addComponent, query } from 'bitecs'
import { angleDelta } from '../angles'
import { bodyBetween, EXPOSED_DISTANCE, STAND_CONE, STAND_REACH } from '../challenge'
import { Defender, DefenderMode, Pressing, Facing, MoveIntent, OffBalance, Outfielder, Physical, Position, Shield, Sliding, Team, Velocity } from '../components'
import { flightRead, gradeT, readLag, topSpeed } from '../grades'
import type { Match } from '../match'
import { attackedGoalX } from '../teams'
import { CONTROL_RADIUS, footDistance, FOOT_OFFSET } from '../touch'
import { seenFacing, seenVx, seenVy, seenX, seenY } from '../perception'
import { STAND_WINDUP } from './challenge'
import { atan2, cos, exp, hypot, sin } from '../fmath'
import { dropPoint, MEET_HEIGHT } from '../flight'

/** Distance a jockeying defender holds off the ball, goal-side. */
const STANDOFF = 1.7
/** Jockey while this close and goal-side; give chase beyond RUN_DISTANCE or once beaten. */
const JOCKEY_DISTANCE = 6
const RUN_DISTANCE = 8
/** How far ahead (s) each mode projects the carrier's read movement. */
const JOCKEY_LOOKAHEAD = 0.3
const RUN_LOOKAHEAD = 0.6
/** When running, aim this far goal-side of the ball, to get back in front of it. */
const RECOVERY_DEPTH = 3
const POSITION_GAIN = 3

/**
 * How often (per second) the defender goes in for each challenge when it's
 * on. Committing is a gamble, so they don't go every time they could.
 */
const POUNCE_RATE = 4
const STAND_RATE_BASE = 0.1
const STAND_RATE_SKILL = 0.3
const STAND_RATE_SHIELDED = 0.4
const BARGE_RATE = 1.2
const SLIDE_RATE_BASE = 0.2
const SLIDE_RATE_SKILL = 0.6
/** Barge from this close (m between centres). */
const BARGE_RANGE = 1.05
/** Slide in for a ball between these distances (m) from the body. */
const SLIDE_MIN = 1.3
const SLIDE_MAX = 3
/** Only a defender running at least this fast (m/s) slides in, and the slide carries them this much (m/s) faster. */
const SLIDE_FROM_SPEED = 4
const SLIDE_LUNGE = 1
/** A standing tackle stretches towards the ball at this speed (m/s); a barge drives in at this much (m/s) over the carrier. */
const LUNGE_SPEED = 1.5
const BARGE_DRIVE = 1.5

/**
 * The defender's decisions. Jockeying keeps a short read lag and a side-on
 * stance, so it mirrors cuts quickly but can only shuffle at sidestep speed.
 * Running is fast but reads late and turns wide.
 */
export function defenderSystem(world: Match, dt: number) {
  for (const eid of query(world, [Pressing, Defender, Outfielder, MoveIntent, Position, Velocity, Facing, Physical])) {
    const ball = world.ball
    // With a keeper holding the ball, everyone is off it.
    if (world.phase === 'held') continue
    if (world.phase !== 'play') {
      stand(eid, ball)
      continue
    }

    // The goal being attacked, which this defender is protecting.
    const goalX = attackedGoalX(world.pitch, Team.id[world.carrier])
    Defender.challengeDelay[eid] = Math.max(0, Defender.challengeDelay[eid] - dt)
    updateRead(world, eid, dt)
    const mode = Defender.mode[eid] as DefenderMode
    // Mid-challenge the challenge system is in charge; off balance, they just stagger.
    if (mode !== DefenderMode.Jockey && mode !== DefenderMode.Run) continue
    if (OffBalance.timer[eid] > 0) {
      MoveIntent.vx[eid] = MoveIntent.vy[eid] = 0
      continue
    }
    // A pass in the air, once they've judged its flight they make for where it comes down, to contest it there.
    // Until then they carry on as they were.
    const drop = world.pass?.lofted ? dropPoint(world, MEET_HEIGHT) : null
    if (drop) {
      Defender.mode[eid] = DefenderMode.Run
      if (world.time - world.pass!.time < flightRead(Outfielder.positioning[eid])) {
        MoveIntent.vx[eid] = Velocity.x[eid]
        MoveIntent.vy[eid] = Velocity.y[eid]
      } else getUnder(eid, drop.x, drop.y, drop.t)
      continue
    }
    if (looseAndNearer(world, eid)) {
      Defender.mode[eid] = DefenderMode.Run
      goForBall(eid)
      continue
    }
    const next = chooseMode(eid, goalX)
    if (world.onDecision && next !== mode) world.onDecision(eid, next === DefenderMode.Run ? 'runs at the ball: too far off it, or not goal-side' : 'jockeys: close enough and goal-side')
    Defender.mode[eid] = next
    if (next === DefenderMode.Jockey) jockey(eid, goalX)
    else run(eid, goalX)
    if (Defender.challengeDelay[eid] === 0) maybeChallenge(world, eid, dt)
  }
}

/**
 * Decide whether to commit to a tackle, slide or barge this tick. Judged on
 * the defender's read of the ball, so a slow reader mistimes challenges;
 * whether they connect is settled against where the ball really is.
 */
function maybeChallenge(world: Match, eid: number, dt: number) {
  const { ball, carrier, rng } = world
  const toBallX = Defender.readX[eid] - Position.x[eid]
  const toBallY = Defender.readY[eid] - Position.y[eid]
  const ballDistance = hypot(toBallX, toBallY)
  const ballAhead = Math.abs(angleDelta(Facing.angle[eid], atan2(toBallY, toBallX)))
  const carrierDistance = hypot(Position.x[carrier] - Position.x[eid], Position.y[carrier] - Position.y[eid])
  // A standing tackle is timed for where the ball will be when the foot gets there: off the carrier's feet, ideally.
  const exposedAtContact = exposedIn(world, eid, STAND_WINDUP)
  const shielded = Shield.active[carrier] === 1 || bodyBetween(carrier, eid, ball)
  const skill = gradeT(Outfielder.tackling[eid])
  const chance = (rate: number) => rng() < rate * dt

  const said = (text: string) => world.onDecision?.(eid, `${text} (ball read ${ballDistance.toFixed(1)} m away, ${Math.round((ballAhead * 180) / Math.PI)}° off their facing)`)
  if (ballDistance <= STAND_REACH && ballAhead <= STAND_CONE) {
    const rate = exposedAtContact ? POUNCE_RATE : shielded ? STAND_RATE_SHIELDED : STAND_RATE_BASE + STAND_RATE_SKILL * skill
    if (chance(rate)) {
      said(`goes in with a standing tackle: ${exposedAtContact ? 'the ball will be off his feet' : shielded ? 'into a shielding carrier' : 'the ball in reach'}`)
      return startStandingTackle(eid)
    }
  }
  if (carrierDistance <= BARGE_RANGE && footDistance(carrier, ball) < CONTROL_RADIUS) {
    // Shoulder in on a carrier who is shielding, or who has the ball alongside.
    const rate = Shield.active[carrier] || Defender.mode[eid] === DefenderMode.Run ? BARGE_RATE : 0
    if (chance(rate)) {
      said(`barges ${Shield.active[carrier] ? 'a shielding carrier' : 'the carrier, running alongside'}`)
      return startBarge(eid, carrier)
    }
  }
  // A slide is the last resort of a beaten defender at full tilt, for a ball the carrier has let out of their feet.
  const beaten = Defender.mode[eid] === DefenderMode.Run
  const running = hypot(Velocity.x[eid], Velocity.y[eid]) >= SLIDE_FROM_SPEED
  if (beaten && running && exposedIn(world, eid, 0) && ballDistance >= SLIDE_MIN && ballDistance <= SLIDE_MAX && ballAhead <= 0.6) {
    if (chance(SLIDE_RATE_BASE + SLIDE_RATE_SKILL * skill)) {
      said('slides in: beaten, at full tilt, and the ball is off his feet')
      startSlide(world, eid)
    }
  }
}

/**
 * Whether, `seconds` from now, the defender reckons the ball will be off the
 * carrier's feet: the ball where they read it to be going, the carrier
 * where they've seen him heading.
 */
function exposedIn(world: Match, eid: number, seconds: number): boolean {
  const carrier = world.carrier
  const facing = seenFacing(world, eid, carrier)
  const fx = seenX(world, eid, carrier) + cos(facing) * FOOT_OFFSET + seenVx(world, eid, carrier) * seconds
  const fy = seenY(world, eid, carrier) + sin(facing) * FOOT_OFFSET + seenVy(world, eid, carrier) * seconds
  const bx = Defender.readX[eid] + Defender.readVx[eid] * seconds
  const by = Defender.readY[eid] + Defender.readVy[eid] * seconds
  return hypot(bx - fx, by - fy) > EXPOSED_DISTANCE
}

function startAction(eid: number, mode: DefenderMode) {
  Defender.mode[eid] = mode
  Defender.actionTime[eid] = 0
  Defender.contacted[eid] = 0
}

/** Stab a foot at the ball. */
function startStandingTackle(eid: number) {
  startAction(eid, DefenderMode.StandTackle)
  const dx = Defender.readX[eid] - Position.x[eid]
  const dy = Defender.readY[eid] - Position.y[eid]
  const len = hypot(dx, dy) || 1
  MoveIntent.vx[eid] = (dx / len) * LUNGE_SPEED
  MoveIntent.vy[eid] = (dy / len) * LUNGE_SPEED
  MoveIntent.faceX[eid] = dx
  MoveIntent.faceY[eid] = dy
}

/** Drive a shoulder into the carrier. */
function startBarge(eid: number, carrier: number) {
  startAction(eid, DefenderMode.Barge)
  const dx = Position.x[carrier] - Position.x[eid]
  const dy = Position.y[carrier] - Position.y[eid]
  const len = hypot(dx, dy) || 1
  MoveIntent.vx[eid] = Velocity.x[carrier] + (dx / len) * BARGE_DRIVE
  MoveIntent.vy[eid] = Velocity.y[carrier] + (dy / len) * BARGE_DRIVE
  MoveIntent.faceX[eid] = 0
  MoveIntent.faceY[eid] = 0
}

/** Go to ground, boot first, along a line to where the ball will be. */
export function startSlide(world: Match, eid: number) {
  startAction(eid, DefenderMode.SlideTackle)
  const tx = Defender.readX[eid] + Defender.readVx[eid] * 0.25 - Position.x[eid]
  const ty = Defender.readY[eid] + Defender.readVy[eid] * 0.25 - Position.y[eid]
  const len = hypot(tx, ty) || 1
  Defender.actionDirX[eid] = tx / len
  Defender.actionDirY[eid] = ty / len
  Facing.angle[eid] = atan2(ty, tx)
  const speed = hypot(Velocity.x[eid], Velocity.y[eid]) + SLIDE_LUNGE
  Velocity.x[eid] = Defender.actionDirX[eid] * speed
  Velocity.y[eid] = Defender.actionDirY[eid] * speed
  addComponent(world, eid, Sliding)
}

/**
 * Advances the defender's read of the ball, then pulls it towards the truth
 * at the defender's reaction rate.
 */
function updateRead(world: Match, eid: number, dt: number) {
  const ball = world.ball
  const lag = readLag(Outfielder.marking[eid], Defender.mode[eid] === DefenderMode.Run)
  const k = 1 - exp(-dt / lag)
  Defender.readX[eid] += Defender.readVx[eid] * dt
  Defender.readY[eid] += Defender.readVy[eid] * dt
  Defender.readX[eid] += (Position.x[ball] - Defender.readX[eid]) * k
  Defender.readY[eid] += (Position.y[ball] - Defender.readY[eid]) * k
  Defender.readVx[eid] += (Velocity.x[ball] - Defender.readVx[eid]) * k
  Defender.readVy[eid] += (Velocity.y[ball] - Defender.readVy[eid]) * k
}

function chooseMode(eid: number, goalX: number): DefenderMode {
  const bx = Defender.readX[eid]
  const by = Defender.readY[eid]
  const distance = hypot(bx - Position.x[eid], by - Position.y[eid])
  const goalSide = distanceToGoal(Position.x[eid], Position.y[eid], goalX) + 0.5 < distanceToGoal(bx, by, goalX)
  if (!goalSide || distance > RUN_DISTANCE) return DefenderMode.Run
  if (distance < JOCKEY_DISTANCE) return DefenderMode.Jockey
  return Defender.mode[eid] as DefenderMode
}

/** Hold a spot just goal-side of where the ball is read to be going, facing it. */
function jockey(eid: number, goalX: number) {
  const { x, y } = goalSideOfRead(eid, goalX, JOCKEY_LOOKAHEAD, STANDOFF)
  MoveIntent.vx[eid] = Defender.readVx[eid] + (x - Position.x[eid]) * POSITION_GAIN
  MoveIntent.vy[eid] = Defender.readVy[eid] + (y - Position.y[eid]) * POSITION_GAIN
  MoveIntent.faceX[eid] = Defender.readX[eid] - Position.x[eid]
  MoveIntent.faceY[eid] = Defender.readY[eid] - Position.y[eid]
}

/** Sprint to get back goal-side of the ball. */
function run(eid: number, goalX: number) {
  const { x, y } = goalSideOfRead(eid, goalX, RUN_LOOKAHEAD, RECOVERY_DEPTH)
  const dx = x - Position.x[eid]
  const dy = y - Position.y[eid]
  const distance = hypot(dx, dy) || 1
  const speed = Math.min(topSpeed(Physical.pace[eid]), distance * POSITION_GAIN)
  MoveIntent.vx[eid] = (dx / distance) * speed
  MoveIntent.vy[eid] = (dy / distance) * speed
  MoveIntent.faceX[eid] = 0
  MoveIntent.faceY[eid] = 0
}

/** The carrier has lost control of the ball and the defender can get there first. */
function looseAndNearer(world: Match, eid: number) {
  const carrierDistance = footDistance(world.carrier, world.ball)
  return carrierDistance > CONTROL_RADIUS && footDistance(eid, world.ball) < carrierDistance
}

/** Attack the loose ball at full pace, towards where it's read to be going. */
function goForBall(eid: number) {
  const dx = Defender.readX[eid] + Defender.readVx[eid] * 0.2 - Position.x[eid]
  const dy = Defender.readY[eid] + Defender.readVy[eid] * 0.2 - Position.y[eid]
  const distance = hypot(dx, dy) || 1
  const speed = topSpeed(Physical.pace[eid])
  MoveIntent.vx[eid] = (dx / distance) * speed
  MoveIntent.vy[eid] = (dy / distance) * speed
  MoveIntent.faceX[eid] = 0
  MoveIntent.faceY[eid] = 0
}

/** Make for (x, y), getting there in `t` seconds if they can, facing the ball. */
function getUnder(eid: number, x: number, y: number, t: number) {
  const dx = x - Position.x[eid]
  const dy = y - Position.y[eid]
  const distance = hypot(dx, dy)
  const speed = distance < 0.2 ? 0 : Math.min(topSpeed(Physical.pace[eid]), distance / Math.max(t, 0.15))
  MoveIntent.vx[eid] = distance > 0 ? (dx / distance) * speed : 0
  MoveIntent.vy[eid] = distance > 0 ? (dy / distance) * speed : 0
  MoveIntent.faceX[eid] = 0
  MoveIntent.faceY[eid] = 0
}

function stand(eid: number, ball: number) {
  MoveIntent.vx[eid] = 0
  MoveIntent.vy[eid] = 0
  MoveIntent.faceX[eid] = Position.x[ball] - Position.x[eid]
  MoveIntent.faceY[eid] = Position.y[ball] - Position.y[eid]
}

/** A point `depth` metres towards goal from where the defender reads the ball to be in `lookahead` seconds. */
function goalSideOfRead(eid: number, goalX: number, lookahead: number, depth: number) {
  const bx = Defender.readX[eid] + Defender.readVx[eid] * lookahead
  const by = Defender.readY[eid] + Defender.readVy[eid] * lookahead
  const gx = goalX - bx
  const gy = -by
  const len = hypot(gx, gy) || 1
  return { x: bx + (gx / len) * depth, y: by + (gy / len) * depth }
}

const distanceToGoal = (x: number, y: number, goalX: number) => hypot(goalX - x, y)

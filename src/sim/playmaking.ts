import { angleDelta } from './angles'
import { Dribbler, Facing, Outfielder, Passer, Position, Team, TouchStyle, Velocity } from './components'
import { BALL_RADIUS, GOAL_X, PITCH_HALF_LENGTH, PITCH_HALF_WIDTH } from './constants'
import { gradeT, judgementError, passAngleError, passWeightError, spotChance } from './grades'
import { handOver, setVec, type Match, type PassKind } from './match'
import { rollSpeedAfter, rollSpeedFor, rollSpeedToArrive, rollTime } from './passing'
import { inOffsidePosition, playBall } from './offside'
import { gaussian } from './rng'
import { arrivalTime } from './space/arrival'
import { passSafety, teamArrival, timeOnBall } from './space/control'
import { threat } from './space/threat'
import { attackDir, attackedGoalX, opponent } from './teams'

/** A pass the carrier could play, and what it's worth. */
export interface PassOption {
  receiver: number
  kind: PassKind
  /** Where the ball is aimed: the receiver's feet, or the spot they'll meet it. */
  x: number
  y: number
  /** How hard (m/s) to strike it along the ground. */
  speed: number
  /** Chance it gets there without being cut out. */
  safety: number
  /** What it's worth to the team: expected threat if it gets there, less the other team's if it's cut out. */
  value: number
}

/** Passes to feet arrive at about this pace (m/s): firm enough not to dawdle, soft enough to take. */
const FEET_ARRIVAL = 6
/** Through balls are struck to meet the runner at between these paces (m/s), so they can run onto it in stride. */
const THROUGH_SLOWEST = 1.5
const THROUGH_FASTEST = 7
/** How far (m) ahead of a teammate to try putting a through ball. */
const THROUGH_LEADS = [4, 7, 10, 13]
/** The ball should get to the meeting point this long (s) after the runner, not before. */
const THROUGH_LAG = 0.1
/** Longest pass (m) worth considering along the ground. */
const MAX_PASS = 35
/** Shortest pass (m) worth playing: any closer and they'd be better keeping it. */
const MIN_PASS = 4
/**
 * Furthest (rad) from where they face that a player can pass. Beyond
 * CLEAN_PASS_TURN the pass is played across the body, and goes less true.
 */
const MAX_PASS_TURN = 2.4
const CLEAN_PASS_TURN = 1
/** A player sees teammates within this angle (rad) either side of where they face; others they may spot by looking. */
const FIELD_OF_VIEW = 1.75
/** Receiving with this many seconds before an opponent arrives counts as fully open. */
const OPEN_TIME = 1.5
/** How sharply a lead in the race to a through ball turns into winning it (s). */
const RACE_SCALE = 0.25
/** A pass has to be worth this much more than keeping the ball before it's played. */
const PASS_MARGIN = 0.01
/** Judgement errors are at least this big, so options worth next to nothing still vary. */
const MIN_JUDGED = 0.02
/** Where along a pass (as a share of its length) a cut-out is reckoned to happen. */
const LOSS_ALONG = 0.35
/** Carrying it on is worth a little more than where the ball is now. */
const CARRY_GAIN = 1.15
/** Weigh up options every DECIDE_EVERY seconds, plus up to DECIDE_SPREAD. */
const DECIDE_EVERY = 0.2
const DECIDE_SPREAD = 0.15
/** Seconds after passing before the passer can play the ball again. */
const PASSER_RECOVER = 0.4
/** An opponent within this distance (m) of the passer hurries the pass. */
const PRESSURE_RANGE = 2

/**
 * The carrier weighs passing against keeping the ball, a few times a second.
 * They consider only teammates they have seen, rate each pass to feet or into
 * space by expected threat, and judge it with an error that shrinks with
 * their decisions grade. Returns the pass to play now, if any.
 */
export function choosePass(world: Match, carrier: number): PassOption | null {
  if (world.time < Passer.nextLook[carrier]) return null
  Passer.nextLook[carrier] = world.time + DECIDE_EVERY + world.rng() * DECIDE_SPREAD

  const error = judgementError(Outfielder.decisions[carrier])
  const judged = (value: number) => value + gaussian(world.rng) * error * Math.max(Math.abs(value), MIN_JUDGED)
  const keep = judged(keepValue(world, carrier))
  let best: PassOption | null = null
  let bestJudged = keep + PASS_MARGIN
  for (const option of passOptions(world, carrier)) {
    const v = judged(option.value)
    if (v > bestJudged) {
      best = option
      bestJudged = v
    }
  }
  return best
}

/**
 * What keeping the ball is worth: if they keep it, the threat where they are
 * plus a little for carrying it on; if they lose it, the threat the other
 * team then has from here. The chance of keeping it falls the less time
 * they have before an opponent is on them, and rises with their dribbling.
 */
export function keepValue(world: Match, carrier: number): number {
  const team = Team.id[carrier]
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  const time = timeOnBall(world, carrier)
  const keep = clamp(0.55 + 0.2 * time + 0.15 * gradeT(Outfielder.dribbling[carrier]), 0.5, 0.97)
  return keep * threat(team, bx, by) * CARRY_GAIN - (1 - keep) * threat(opponent(team), bx, by)
}

/**
 * A pass's worth: the receiver's value if it gets through, less the threat
 * the other team has from where it would be cut out.
 */
function passValue(team: number, safety: number, received: number, bx: number, by: number, x: number, y: number) {
  const lostX = bx + (x - bx) * LOSS_ALONG
  const lostY = by + (y - by) * LOSS_ALONG
  return safety * received - (1 - safety) * threat(opponent(team), lostX, lostY)
}

/** The passes `carrier` could play to the teammates they can see, each rated. */
export function passOptions(world: Match, carrier: number): PassOption[] {
  const team = Team.id[carrier]
  const options: PassOption[] = []
  for (const mate of world.teams[team].outfielders) {
    // A teammate in an offside position now would be offside the moment it's played.
    if (mate === carrier || inOffsidePosition(world, mate) || !sees(world, carrier, mate)) continue
    const feet = toFeet(world, carrier, mate)
    if (feet) options.push(feet)
    for (const lead of THROUGH_LEADS) {
      const through = intoSpace(world, carrier, mate, lead)
      if (through) options.push(through)
    }
  }
  return options
}

/** Whether `carrier` has `mate` in view: in their field of view, or spotted with a look around. */
function sees(world: Match, carrier: number, mate: number): boolean {
  const angle = Math.atan2(Position.y[mate] - Position.y[carrier], Position.x[mate] - Position.x[carrier])
  if (Math.abs(angleDelta(Facing.angle[carrier], angle)) <= FIELD_OF_VIEW) return true
  return world.rng() < spotChance(Outfielder.vision[carrier])
}

/** A pass to where `mate` will be, arriving at a pace they can take. */
function toFeet(world: Match, carrier: number, mate: number): PassOption | null {
  const ball = world.ball
  const bx = Position.x[ball]
  const by = Position.y[ball]
  // Lead them by where they're running, about as long as the pass will take.
  const rough = Math.hypot(Position.x[mate] - bx, Position.y[mate] - by) / 12
  const x = Position.x[mate] + Velocity.x[mate] * rough
  const y = Position.y[mate] + Velocity.y[mate] * rough
  const distance = Math.hypot(x - bx, y - by)
  if (!playable(carrier, bx, by, x, y, distance)) return null
  const speed = rollSpeedFor(distance, FEET_ARRIVAL)
  const safety = passSafety(world, Team.id[carrier], bx, by, x, y, speed)
  const value = passValue(Team.id[carrier], safety, receiveValue(world, mate, x, y, rollTime(speed, distance)), bx, by, x, y)
  return { receiver: mate, kind: 'feet', x, y, speed, safety, value }
}

/**
 * A pass into the space `lead` metres ahead of `mate`, towards the goal they
 * attack. It is weighted to meet them there just after they arrive, so they
 * can run onto it in stride.
 */
function intoSpace(world: Match, carrier: number, mate: number, lead: number): PassOption | null {
  const team = Team.id[carrier]
  const ball = world.ball
  const bx = Position.x[ball]
  const by = Position.y[ball]
  const gx = attackedGoalX(team) - Position.x[mate]
  const gy = -Position.y[mate]
  const glen = Math.hypot(gx, gy)
  if (glen < 1) return null
  const x = clamp(Position.x[mate] + (gx / glen) * lead, -GOAL_X + 1, GOAL_X - 1)
  const y = clamp(Position.y[mate] + (gy / glen) * lead, -PITCH_HALF_WIDTH + 1, PITCH_HALF_WIDTH - 1)
  const distance = Math.hypot(x - bx, y - by)
  if (!playable(carrier, bx, by, x, y, distance)) return null

  const runner = arrivalTime(world, mate, x, y, 0.5)
  let speed = rollSpeedToArrive(distance, runner + THROUGH_LAG)
  // Too slow and it dies before they get there; too fast and they can't run onto it.
  if (speed === Infinity || rollSpeedAfter(speed, runner + THROUGH_LAG) > THROUGH_FASTEST) speed = rollSpeedFor(distance, THROUGH_FASTEST)
  else if (rollSpeedAfter(speed, runner + THROUGH_LAG) < THROUGH_SLOWEST) speed = rollSpeedFor(distance, THROUGH_SLOWEST)
  const ballTime = rollTime(speed, distance)
  const meet = Math.max(runner, ballTime)
  // They have to win the race to the ball, the keeper included.
  const race = 1 / (1 + Math.exp(-(teamArrival(world, opponent(team), x, y, 0.5) - meet) / RACE_SCALE))
  const safety = passSafety(world, team, bx, by, x, y, speed) * race
  const value = passValue(team, safety, receiveValue(world, mate, x, y, meet), bx, by, x, y)
  return { receiver: mate, kind: 'through', x, y, speed, safety, value }
}

/** Whether a pass from (bx, by) to (x, y) is one the carrier can play from how they stand. */
function playable(carrier: number, bx: number, by: number, x: number, y: number, distance: number): boolean {
  if (distance < MIN_PASS || distance > MAX_PASS) return false
  if (Math.abs(x) > PITCH_HALF_LENGTH - 0.5 || Math.abs(y) > PITCH_HALF_WIDTH - 0.5) return false
  return Math.abs(angleDelta(Facing.angle[carrier], Math.atan2(y - by, x - bx))) <= MAX_PASS_TURN
}

/**
 * What it's worth for `receiver` to get the ball at (x, y) at time `arrive`:
 * the threat there, more of it the longer they'd have before an opponent
 * closes them down, and a little more if they're already facing forward.
 */
function receiveValue(world: Match, receiver: number, x: number, y: number, arrive: number): number {
  const team = Team.id[receiver]
  const time = teamArrival(world, opponent(team), x, y, 0.95) - arrive
  const open = clamp(time / OPEN_TIME, 0, 1)
  const forward = Math.max(0, Math.cos(angleDelta(Facing.angle[receiver], attackDir(team) > 0 ? 0 : Math.PI)))
  return threat(team, x, y) * (0.5 + 0.5 * open) * (0.85 + 0.15 * forward)
}

/**
 * Strikes the pass. It goes off line and off weight with an error that
 * shrinks with the passing grade, grows with distance, and grows when the
 * passer is hurried. The receiver takes over as the carrier while it travels.
 */
export function strikePass(world: Match, carrier: number, option: PassOption) {
  if (!playBall(world, carrier)) return
  const { ball, rng } = world
  const bx = Position.x[ball]
  const by = Position.y[ball]
  const distance = Math.hypot(option.x - bx, option.y - by)
  const presser = world.presser
  const gap = Math.hypot(Position.x[presser] - Position.x[carrier], Position.y[presser] - Position.y[carrier])
  const hurried = 1 + Math.max(0, 1 - gap / PRESSURE_RANGE)
  const passing = Outfielder.passing[carrier]
  const aim = Math.atan2(option.y - by, option.x - bx)
  const across = 1 + Math.max(0, Math.abs(angleDelta(Facing.angle[carrier], aim)) - CLEAN_PASS_TURN)
  const angle = aim + gaussian(rng) * passAngleError(passing) * hurried * across * (1 + distance / 30)
  const speed = option.speed * Math.max(0.3, 1 + gaussian(rng) * passWeightError(passing) * hurried)
  setVec(Velocity, ball, Math.cos(angle) * speed, Math.sin(angle) * speed, 0)
  Position.z[ball] = BALL_RADIUS

  Dribbler.style[carrier] = TouchStyle.None
  Dribbler.cooldown[carrier] = PASSER_RECOVER
  world.lastTouch = null
  world.lastTouchedBy = carrier
  world.lastTouchDeliberate = true
  const team = Team.id[carrier]
  world.stats[team].passes++
  world.pass = { from: carrier, to: option.receiver, kind: option.kind, x: option.x, y: option.y, time: world.time }
  handOver(world, option.receiver)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

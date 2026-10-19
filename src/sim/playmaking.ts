import { angleDelta } from './angles'
import { Call, CallKind, Dribbler, Facing, Outfielder, Passer, Position, Team, TouchStyle, Velocity } from './components'
import { BALL_RADIUS } from './constants'
import { aerialControlChance, gradeT, judgementError, loftCarryError, offsideMisjudgement, passAngleError, passWeightError } from './grades'
import { cue } from './cues'
import { handOver, setVec, type Match, type PassKind } from './match'
import { rollSpeedAfter, rollSpeedFor, rollSpeedToArrive, rollTime } from './passing'
import { playBall } from './offside'
import { along, onsideLimit } from './shape'
import { knows, seenFacing, seenVx, seenVy, seenX, seenY } from './perception'
import { gaussian } from './rng'
import { arrivalTime, REACTION_TIME } from './space/arrival'
import { loftSafety, passSafety, teamArrival, timeOnBall } from './space/control'
import { launchUp, loftFlightTime } from './flight'
import { shotValue } from './finishing'
import { planCarry } from './carrying'
import { shotChance, threat } from './space/threat'
import { attackDir, attackedGoalX, opponent } from './teams'
import { atan2, cos, exp, hypot, sin } from './fmath'
import { playerLabel } from './trace'

/** A pass the carrier could play, and what it's worth. */
export interface PassOption {
  receiver: number
  kind: PassKind
  /** Where the ball is aimed: the receiver's feet, or the spot they'll meet it. */
  x: number
  y: number
  /** How hard (m/s) to strike it: along the ground, or for a lofted pass, its pace over the ground. */
  speed: number
  /** Seconds a lofted pass is in the air before it lands; 0 for a pass along the ground. */
  flight: number
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
/**
 * Longest pass (m) worth considering along the ground: 35 m, or on a bigger
 * pitch this share of its length, so a switch or a ball over the top of a
 * full-size pitch is on.
 */
const MAX_PASS = 35
const MAX_PASS_SHARE = 0.45
/**
 * Passes of at least LOFT_MIN metres, up to LOFT_MAX, may be lofted: a
 * switch, a ball over the top, a long ball forward. From wide in the final
 * third a cross into the box may be as short as CROSS_MIN.
 */
const LOFT_MIN = 22
const LOFT_MAX = 55
const CROSS_MIN = 8
/** A lofted pass is dropped at least this far (m) inside the lines. */
const LOFT_INSIDE = 3
/** How far ahead (m) of a teammate running in behind to drop a ball over the top for them to run onto. */
const LOFT_LEADS = [5, 10, 15]
/** A ball over the top should land no more than this long (s) before the runner gets there, or it bounces away from them. */
const LOFT_EARLY = 0.8
/**
 * Of the dropping balls a receiver doesn't control, the share their team
 * still comes away with: it's loose at their feet, and theirs as often as not.
 */
const MISCONTROL_KEPT = 0.5
/** Shortest pass (m) worth playing: any closer and they'd be better keeping it. */
const MIN_PASS = 4
/**
 * Furthest (rad) from where they face that a player can pass. Beyond
 * CLEAN_PASS_TURN the pass is played across the body, and goes less true.
 */
const MAX_PASS_TURN = 2.4
const CLEAN_PASS_TURN = 1
/** Receiving with this many seconds before an opponent arrives counts as fully open. */
const OPEN_TIME = 1.5
/**
 * How much of the threat where they'd get it hangs on being open: a receiver
 * closed down at once keeps the rest, as most do keep a ball played to them.
 */
const OPEN_WEIGHT = 0.25
/** How sharply a lead in the race to a through ball turns into winning it (s). */
const RACE_SCALE = 0.25
/** A pass has to be worth this much more than keeping the ball before it's played. */
const PASS_MARGIN = 0
/** Judgement errors are at least this big, so options worth next to nothing still vary. */
const MIN_JUDGED = 0.002
/** Where along a pass (as a share of its length) a cut-out is reckoned to happen. */
const LOSS_ALONG = 0.35
/** Carrying it on is worth a little more than where the ball is now. */
const CARRY_GAIN = 1.15
/** With this long (s) before they're closed down, a carrier has an even chance of carrying it on. */
const CARRY_MOMENT = 0.5
/** How sharply (s) more time than that turns into carrying it on. */
const CARRY_MOMENT_SCALE = 0.2
/**
 * A carrier who can't get anywhere better ends up with about this share of
 * the chance from here: they're being closed down, and the shot only gets harder.
 */
const NOW_SHARE = 0.5
/** Weigh up options every DECIDE_EVERY seconds, plus up to DECIDE_SPREAD. */
const DECIDE_EVERY = 0.2
const DECIDE_SPREAD = 0.15
/**
 * A pass straight back to whoever played it within RETURN_WINDOW seconds,
 * moving the ball on less than RETURN_PROGRESS metres, is worth RETURN_SHARE
 * of what having the ball where it is is worth less, whichever pass back it
 * is: so it's played only when nothing else is nearly as good.
 */
export const RETURN_WINDOW = 5
const RETURN_PROGRESS = 5
const RETURN_SHARE = 2
/**
 * Deep in their own half that's next to nothing, so two players being pressed
 * could knock it between themselves for ever. Past FREE_EXCHANGES passes in a
 * row between the two of them, each more costs EXCHANGE_SHARE of what the other
 * team would have from here: the pressers have had time to shuffle across, and
 * it's time to try something else.
 */
const FREE_EXCHANGES = 3
const EXCHANGE_SHARE = 0.05
/** Seconds after passing before the passer can play the ball again. */
const PASSER_RECOVER = 0.4
/** A pass played on first time goes this many times further astray than one from a ball they've set. */
const FIRST_TIME_ERROR = 1.4
/** A ground pass's line error grows by its own size every LINE_DISTANCE metres it travels; a lofted pass's every LOFT_LINE_DISTANCE. */
const LINE_DISTANCE = 30
const LOFT_LINE_DISTANCE = 60
/** An opponent within this distance (m) of the passer hurries the pass. */
const PRESSURE_RANGE = 2

/** The pass to play now, if any, weighing passing against keeping the ball only. */
export function choosePass(world: Match, carrier: number): PassOption | null {
  const choice = chooseAction(world, carrier, null)
  return choice === 'shoot' ? null : choice
}

/**
 * The carrier weighs keeping the ball, shooting and passing against each
 * other, a few times a second, all as expected goals. `shot` is what they
 * reckon a shot from here is worth, or null if there's no shot on. They
 * consider only teammates they have seen, rate each pass to feet or into
 * space by expected threat, and judge every option with an error that
 * shrinks with their decisions grade. Returns the shot or pass to play now,
 * or null to keep the ball.
 */
export function chooseAction(world: Match, carrier: number, shot: number | null): PassOption | 'shoot' | null {
  if (world.time < Passer.nextLook[carrier]) return null
  Passer.nextLook[carrier] = world.time + DECIDE_EVERY + world.rng() * DECIDE_SPREAD

  const error = judgementError(Outfielder.decisions[carrier])
  const judged = (value: number) => value + gaussian(world.rng) * error * Math.max(Math.abs(value), MIN_JUDGED)
  const kept = keepValue(world, carrier)
  const keep = judged(kept)
  // What they weighed, as text, only for someone reading the match back.
  const weighed: { judged: number; text: string }[] | null = world.onDecision ? [{ judged: keep + PASS_MARGIN, text: `keep ${worth(keep, kept)}` }] : null
  let best: PassOption | 'shoot' | null = null
  let bestJudged = keep + PASS_MARGIN
  if (shot !== null) {
    const v = judged(shot)
    weighed?.push({ judged: v, text: `shoot ${worth(v, shot)}` })
    if (v > bestJudged) {
      best = 'shoot'
      bestJudged = v
    }
  }
  for (const option of passOptions(world, carrier)) {
    const back = returnCost(world, carrier, option)
    const v = judged(option.value) - back
    weighed?.push({ judged: v, text: `${describe(option)} to ${playerLabel(world, option.receiver)} ${worth(v, option.value)} safety ${option.safety.toFixed(2)}${back ? ' straight back' : ''}` })
    if (v > bestJudged) {
      best = option
      bestJudged = v
    }
  }
  if (weighed) {
    const choice = best === null ? 'keeps the ball' : best === 'shoot' ? 'shoots' : `passes ${describe(best)} to ${playerLabel(world, best.receiver)}`
    weighed.sort((a, b) => b.judged - a.judged)
    const shown = weighed.slice(0, WEIGHED_SHOWN).map((w) => w.text).join(', ')
    const more = weighed.length > WEIGHED_SHOWN ? `, and ${weighed.length - WEIGHED_SHOWN} worse` : ''
    world.onDecision!(carrier, `${choice} | best first, judged (true) xG: ${shown}${more}`)
  }
  return best
}

/** A pass's kind, as read back: `feet`, `through`, or either `lofted`. */
const describe = (option: PassOption) => (option.flight > 0 ? `lofted ${option.kind}` : option.kind)

/** How many of the options weighed to list, best first. */
const WEIGHED_SHOWN = 5

/** A value as judged, with its true value after it. */
const worth = (judged: number, truth: number) => `${judged.toFixed(3)} (${truth.toFixed(3)})`

/**
 * What it costs to give the ball straight back to whoever just passed it:
 * nothing if it moves the ball on, as a one-two does, but otherwise the two
 * of them are only knocking it between themselves, and the longer they keep
 * that up the more it costs. It's the same for every pass back to them, so it
 * never makes a worse one look better.
 */
export function returnCost(world: Match, carrier: number, option: PassOption): number {
  if (option.receiver !== Passer.receivedFrom[carrier] || world.time - Passer.receivedAt[carrier] > RETURN_WINDOW) return 0
  const team = Team.id[carrier]
  if (along(team, option.x) - along(team, Position.x[world.ball]) >= RETURN_PROGRESS) return 0
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  const beyond = Math.max(0, Passer.exchanges[carrier] + 1 - FREE_EXCHANGES)
  return RETURN_SHARE * threat(world.pitch, team, bx, by) + beyond * EXCHANGE_SHARE * threat(world.pitch, opponent(team), bx, by)
}

/**
 * What keeping the ball is worth: if they keep it, the threat where they are
 * plus a little for carrying it on; if they lose it, the threat the other
 * team then has from here. The chance of keeping it falls the less time
 * they have before an opponent is on them, and rises with their dribbling;
 * when the best carry they see means taking their man on, it's no better
 * than their chance of beating him (see `planCarry`).
 */
export function keepValue(world: Match, carrier: number): number {
  const team = Team.id[carrier]
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  // How long they reckon they have: a defender closing in from behind, unseen, isn't counted where they really are.
  const time = timeOnBall(world, carrier, carrier)
  // Keeping it means taking their man on if there's no way round him: no better than their chance of beating him.
  const plan = planCarry(world, carrier)
  const keep = Math.min(clamp(0.55 + 0.2 * time + 0.15 * gradeT(Outfielder.dribbling[carrier]), 0.5, 0.97), plan.takeOn ? plan.kept : 1)
  // Holding on, the shot they have now only gets harder. Carrying it on adds what the better shot it leads to
  // is worth over a clean one from here, but only if they have a moment on the ball to carry it on at all.
  const gain = Math.max(0, threat(world.pitch, team, bx, by) * CARRY_GAIN - shotChance(world.pitch, bx * attackDir(team), by))
  const moment = 1 / (1 + exp(-(time - CARRY_MOMENT) / CARRY_MOMENT_SCALE))
  const kept = shotValue(world, carrier) * NOW_SHARE + gain * moment
  return keep * kept - (1 - keep) * threat(world.pitch, opponent(team), bx, by)
}

/**
 * A pass's worth: the receiver's value if it gets through, less the threat
 * the other team has from where it would be cut out, `lossAlong` of the way
 * to (x, y).
 */
function passValue(world: Match, team: number, safety: number, received: number, bx: number, by: number, x: number, y: number, lossAlong = LOSS_ALONG) {
  const lostX = bx + (x - bx) * lossAlong
  const lostY = by + (y - by) * lossAlong
  return safety * received - (1 - safety) * threat(world.pitch, opponent(team), lostX, lostY)
}

/**
 * The passes `carrier` could play to the teammates they know of, each rated
 * from where they reckon everyone is (see `perception`).
 */
export function passOptions(world: Match, carrier: number): PassOption[] {
  const team = Team.id[carrier]
  const options: PassOption[] = []
  const cross = crossSpots(world, team)
  for (const mate of world.teams[team].outfielders) {
    // A teammate who looks offside now would be offside the moment it's played.
    if (mate === carrier || !knows(world, carrier, mate) || looksOffside(world, carrier, mate)) continue
    const feet = toFeet(world, carrier, mate)
    if (feet) options.push(feet)
    // Into space towards goal, or towards where they're calling for it.
    const calling = Call.kind[mate] === CallKind.Space
    const goalX = attackedGoalX(world.pitch, team)
    for (const lead of THROUGH_LEADS) {
      const through = intoSpace(world, carrier, mate, lead, goalX, 0)
      if (through) options.push(through)
      const called = calling ? intoSpace(world, carrier, mate, lead, Call.x[mate], Call.y[mate]) : null
      if (called) options.push(called)
    }
    // Or in the air: to them, or, when they're calling for it in behind, over the top for them to run onto.
    const lofted = loftToFeet(world, carrier, mate)
    if (lofted) options.push(lofted)
    if (calling) {
      for (const lead of LOFT_LEADS) {
        const over = loftIntoSpace(world, carrier, mate, lead, Call.x[mate], Call.y[mate])
        if (over) options.push(over)
      }
    }
    // From out wide in the final third, crossed into the box for them to attack.
    if (cross) {
      for (const [u, y] of cross) {
        const into = loftInto(world, carrier, mate, u * attackDir(team), y)
        if (into) options.push(into)
      }
    }
  }
  return options
}

/**
 * Whether `mate` looks offside to `carrier`: judged by eye against the line
 * as they last saw it, so a teammate near the line may be misjudged either
 * way, by less the better their decisions.
 */
function looksOffside(world: Match, carrier: number, mate: number): boolean {
  const team = Team.id[mate]
  const misjudged = along(team, seenX(world, carrier, mate)) + gaussian(world.rng) * offsideMisjudgement(Outfielder.decisions[carrier])
  return misjudged > Math.max(onsideLimit(world, team, carrier), 0)
}

/** A pass to where `mate` will be, arriving at a pace they can take. */
function toFeet(world: Match, carrier: number, mate: number): PassOption | null {
  const ball = world.ball
  const bx = Position.x[ball]
  const by = Position.y[ball]
  // Lead them by where they're running, about as long as the pass will take.
  const mx = seenX(world, carrier, mate)
  const my = seenY(world, carrier, mate)
  const rough = hypot(mx - bx, my - by) / 12
  const x = mx + seenVx(world, carrier, mate) * rough
  const y = my + seenVy(world, carrier, mate) * rough
  const distance = hypot(x - bx, y - by)
  if (!playable(world, carrier, bx, by, x, y, distance)) return null
  const { speed, safety, value } = rateFeetPass(world, Team.id[carrier], mate, x, y, carrier, bx, by, true)
  return { receiver: mate, kind: 'feet', x, y, speed, flight: 0, safety, value }
}

/**
 * How good a pass to `receiver`'s feet at (x, y) would be from where the
 * ball is now, or from (bx, by), as `judge` reckons it. Off-ball players use
 * it too, to pick a spot to show for it or to open a lane: only for a
 * receiver who is `there` already does it count their coming to meet it.
 */
export function rateFeetPass(world: Match, team: number, receiver: number, x: number, y: number, judge = -1, bx = Position.x[world.ball], by = Position.y[world.ball], there = false) {
  const distance = hypot(x - bx, y - by)
  const speed = rollSpeedFor(distance, FEET_ARRIVAL)
  // Only a receiver already about there steps in to meet it; one judging a spot to move to isn't there yet.
  const safety = passSafety(world, team, bx, by, x, y, speed, judge, there ? receiver : -1)
  const value = passValue(world, team, safety, receiveValue(world, receiver, x, y, rollTime(speed, distance), judge), bx, by, x, y)
  return { speed, safety, value }
}

/**
 * A pass into the space `lead` metres ahead of `mate`, in the direction of
 * (towardX, towardY). It is weighted to meet them there just after they
 * arrive, so they can run onto it in stride.
 */
function intoSpace(world: Match, carrier: number, mate: number, lead: number, towardX: number, towardY: number): PassOption | null {
  const team = Team.id[carrier]
  const ball = world.ball
  const bx = Position.x[ball]
  const by = Position.y[ball]
  const mx = seenX(world, carrier, mate)
  const my = seenY(world, carrier, mate)
  const gx = towardX - mx
  const gy = towardY - my
  const glen = hypot(gx, gy)
  if (glen < 1) return null
  const { halfLength: L, halfWidth: W } = world.pitch
  const x = clamp(mx + (gx / glen) * lead, -L + 1, L - 1)
  const y = clamp(my + (gy / glen) * lead, -W + 1, W - 1)
  const distance = hypot(x - bx, y - by)
  if (!playable(world, carrier, bx, by, x, y, distance)) return null

  const runner = arrivalTime(world, mate, x, y, 0.5, REACTION_TIME, carrier)
  let speed = rollSpeedToArrive(distance, runner + THROUGH_LAG)
  // Too slow and it dies before they get there; too fast and they can't run onto it.
  if (speed === Infinity || rollSpeedAfter(speed, runner + THROUGH_LAG) > THROUGH_FASTEST) speed = rollSpeedFor(distance, THROUGH_FASTEST)
  else if (rollSpeedAfter(speed, runner + THROUGH_LAG) < THROUGH_SLOWEST) speed = rollSpeedFor(distance, THROUGH_SLOWEST)
  const ballTime = rollTime(speed, distance)
  const meet = Math.max(runner, ballTime)
  // They have to win the race to the ball, the keeper included.
  const race = 1 / (1 + exp(-(teamArrival(world, opponent(team), x, y, 0.5, carrier) - meet) / RACE_SCALE))
  const safety = passSafety(world, team, bx, by, x, y, speed, carrier) * race
  const value = passValue(world, team, safety, receiveValue(world, mate, x, y, meet, carrier), bx, by, x, y)
  return { receiver: mate, kind: 'through', x, y, speed, flight: 0, safety, value }
}

/**
 * A ball lofted to drop where `mate` will be once it comes down: over
 * anyone in the way, to be won in the air or brought down where it lands.
 */
function loftToFeet(world: Match, carrier: number, mate: number): PassOption | null {
  const team = Team.id[carrier]
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  const mx = seenX(world, carrier, mate)
  const my = seenY(world, carrier, mate)
  // Lead them by where they're running, about as long as the ball will hang.
  let x = mx
  let y = my
  for (let i = 0; i < 2; i++) {
    const flight = loftFlightTime(hypot(x - bx, y - by))
    x = mx + seenVx(world, carrier, mate) * flight
    y = my + seenVy(world, carrier, mate) * flight
  }
  const distance = hypot(x - bx, y - by)
  if (!loftable(world, carrier, bx, by, x, y, distance)) return null
  const flight = loftFlightTime(distance)
  const safety = loftSafety(world, team, bx, by, x, y, flight, mate, carrier) * controlled(mate)
  const value = passValue(world, team, safety, receiveValue(world, mate, x, y, flight, carrier), bx, by, x, y, 1)
  return { receiver: mate, kind: 'feet', x, y, speed: distance / flight, flight, safety, value }
}

/**
 * A ball lofted over the top, to drop `lead` metres ahead of `mate` in the
 * direction of (towardX, towardY), for them to run onto.
 */
function loftIntoSpace(world: Match, carrier: number, mate: number, lead: number, towardX: number, towardY: number): PassOption | null {
  const mx = seenX(world, carrier, mate)
  const my = seenY(world, carrier, mate)
  const gx = towardX - mx
  const gy = towardY - my
  const glen = hypot(gx, gy)
  if (glen < 1) return null
  const { halfLength: L, halfWidth: W } = world.pitch
  return loftInto(world, carrier, mate, clamp(mx + (gx / glen) * lead, -L + 1, L - 1), clamp(my + (gy / glen) * lead, -W + 1, W - 1))
}

/**
 * A ball lofted into the space at (x, y), to drop there just before `mate`
 * gets there, bouncing on as it is if they're not there yet.
 */
function loftInto(world: Match, carrier: number, mate: number, x: number, y: number): PassOption | null {
  const team = Team.id[carrier]
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  const distance = hypot(x - bx, y - by)
  if (!loftable(world, carrier, bx, by, x, y, distance)) return null
  const flight = loftFlightTime(distance)
  const runner = arrivalTime(world, mate, x, y, 0.5, REACTION_TIME, carrier)
  // Landing too far ahead of them, it bounces on out of their reach.
  if (flight < runner - LOFT_EARLY) return null
  const meet = Math.max(runner, flight)
  const safety = loftSafety(world, team, bx, by, x, y, flight, mate, carrier) * controlled(mate)
  const value = passValue(world, team, safety, receiveValue(world, mate, x, y, meet, carrier), bx, by, x, y, 1)
  return { receiver: mate, kind: 'through', x, y, speed: distance / flight, flight, safety, value }
}

/**
 * Where in the box a cross from where the ball is could be aimed, as
 * (along, y): the near post, the penalty spot and the far post. Null unless
 * the ball is out wide in the final third.
 */
function crossSpots(world: Match, team: number): [number, number][] | null {
  const { pitch } = world
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  const L = pitch.halfLength
  if (along(team, bx) <= L / 3 || Math.abs(by) <= pitch.penaltyAreaHalfWidth) return null
  const side = Math.sign(by)
  return [
    [L - NEAR_POST[0], side * NEAR_POST[1]],
    [L - pitch.penaltySpotDistance, 0],
    [L - FAR_POST[0], -side * FAR_POST[1]],
  ]
}

/** Where (m out from the goal line, and across from the middle towards the ball, or away from it) crosses are aimed at the near and far posts. */
const NEAR_POST: [number, number] = [6, 3]
const FAR_POST: [number, number] = [7, 4]

/** The share of lofted balls `mate` would bring down, or be first to once they've got away from them. */
function controlled(mate: number): number {
  const c = aerialControlChance(Outfielder.firstTouch[mate])
  return c + (1 - c) * MISCONTROL_KEPT
}

/**
 * Whether a pass from (bx, by) to (x, y) can be lofted: long enough to be
 * worth putting in the air, or a cross from wide into the box, to drop
 * inside the lines, and one the carrier can play from how they stand.
 */
function loftable(world: Match, carrier: number, bx: number, by: number, x: number, y: number, distance: number): boolean {
  if (distance > LOFT_MAX || distance < (crossing(world, Team.id[carrier], bx, by, x, y) ? CROSS_MIN : LOFT_MIN)) return false
  // Dropped near a line, it's as likely to bounce out as to be taken.
  if (Math.abs(x) > world.pitch.halfLength - LOFT_INSIDE || Math.abs(y) > world.pitch.halfWidth - LOFT_INSIDE) return false
  return Math.abs(angleDelta(Facing.angle[carrier], atan2(y - by, x - bx))) <= MAX_PASS_TURN
}

/** Whether a ball from (bx, by) to (x, y) is a cross: from wide in the final third into the box `team` attacks. */
function crossing(world: Match, team: number, bx: number, by: number, x: number, y: number): boolean {
  const { pitch } = world
  const L = pitch.halfLength
  return along(team, bx) > L / 3 && Math.abs(by) > pitch.penaltyAreaHalfWidth && along(team, x) > L - pitch.penaltyAreaDepth && Math.abs(y) < pitch.penaltyAreaHalfWidth
}

/** Whether a pass from (bx, by) to (x, y) is one the carrier can play from how they stand. */
function playable(world: Match, carrier: number, bx: number, by: number, x: number, y: number, distance: number): boolean {
  if (distance < MIN_PASS || distance > Math.max(MAX_PASS, MAX_PASS_SHARE * 2 * world.pitch.halfLength)) return false
  if (Math.abs(x) > world.pitch.halfLength - 0.5 || Math.abs(y) > world.pitch.halfWidth - 0.5) return false
  return Math.abs(angleDelta(Facing.angle[carrier], atan2(y - by, x - bx))) <= MAX_PASS_TURN
}

/**
 * What it's worth for `receiver` to get the ball at (x, y) at time `arrive`:
 * the threat there, more of it the longer they'd have before an opponent
 * closes them down, and a little more if they're already facing forward;
 * as `judge` reckons it.
 */
function receiveValue(world: Match, receiver: number, x: number, y: number, arrive: number, judge = -1): number {
  const team = Team.id[receiver]
  const time = teamArrival(world, opponent(team), x, y, 0.95, judge) - arrive
  const open = clamp(time / OPEN_TIME, 0, 1)
  const forward = Math.max(0, cos(angleDelta(seenFacing(world, judge, receiver), attackDir(team) > 0 ? 0 : Math.PI)))
  return threat(world.pitch, team, x, y) * (1 - OPEN_WEIGHT + OPEN_WEIGHT * open) * (0.85 + 0.15 * forward)
}

/**
 * Strikes the pass. It goes off line and off weight with an error that
 * shrinks with the passing grade, grows with distance, and grows when the
 * passer is hurried, or plays it on first time; a lofted pass carries too
 * far or not far enough by a share of its length. The receiver takes over
 * as the carrier while it travels.
 */
export function strikePass(world: Match, carrier: number, option: PassOption, firstTime = false) {
  if (!playBall(world, carrier)) return
  const { ball, rng } = world
  const bx = Position.x[ball]
  const by = Position.y[ball]
  const distance = hypot(option.x - bx, option.y - by)
  const presser = world.presser
  const gap = hypot(Position.x[presser] - Position.x[carrier], Position.y[presser] - Position.y[carrier])
  const hurried = (1 + Math.max(0, 1 - gap / PRESSURE_RANGE)) * (firstTime ? FIRST_TIME_ERROR : 1)
  const passing = Outfielder.passing[carrier]
  const aim = atan2(option.y - by, option.x - bx)
  const across = 1 + Math.max(0, Math.abs(angleDelta(Facing.angle[carrier], aim)) - CLEAN_PASS_TURN)
  const lofted = option.flight > 0
  // Struck along the ground, a pass strays further the further it goes; in the air its line is truer, but it goes as
  // far as it was struck to, more or less: a share of its length off, either way.
  const angle = aim + gaussian(rng) * passAngleError(passing) * hurried * across * (1 + distance / (lofted ? LOFT_LINE_DISTANCE : LINE_DISTANCE))
  if (lofted) {
    const carry = distance * Math.max(0.3, 1 + gaussian(rng) * loftCarryError(passing) * hurried)
    const flight = loftFlightTime(carry)
    setVec(Velocity, ball, (cos(angle) * carry) / flight, (sin(angle) * carry) / flight, launchUp(flight))
  } else {
    const speed = option.speed * Math.max(0.3, 1 + gaussian(rng) * passWeightError(passing) * hurried)
    setVec(Velocity, ball, cos(angle) * speed, sin(angle) * speed, 0)
  }
  Position.z[ball] = BALL_RADIUS

  Dribbler.style[carrier] = TouchStyle.None
  Dribbler.cooldown[carrier] = PASSER_RECOVER
  world.lastTouch = null
  world.lastTouchedBy = carrier
  world.lastTouchDeliberate = true
  const team = Team.id[carrier]
  world.stats[team].passes++
  world.pass = { from: carrier, to: option.receiver, kind: option.kind, lofted: option.flight > 0, x: option.x, y: option.y, time: world.time }
  handOver(world, option.receiver)
  cue(world, { kind: 'passStruck', passer: carrier, receiver: option.receiver })
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

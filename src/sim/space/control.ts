import { Outfielder, Physical, Position, Team } from '../components'
import { aerialDuelChance, flightRead } from '../grades'
import type { Pitch } from '../pitch'
import type { Match } from '../match'
import { rollTime } from '../passing'
import { ownGoalX } from '../teams'
import { FOOT_OFFSET, TOUCH_REACH } from '../touch'
import { view, type View } from '../perception'
import { arrivalTime, fastest, isKeeper, REACTION_TIME } from './arrival'
import { exp, hypot } from '../fmath'
import { BALL_RESTITUTION, GRAVITY } from '../constants'
import { afterBounce, heightAt, launchUp } from '../flight'

/**
 * How sharply arrival-time gaps turn into certainty (s). A team that is this
 * much quicker to a spot controls it about three times in four.
 */
const CONTROL_SCALE = 0.25
/** How sharply a lead over the ball turns into an interception (s). */
const INTERCEPT_SCALE = 0.15
/** How far (m) from their centre a player can stretch to stop a ball going past. */
const INTERCEPT_REACH = FOOT_OFFSET + TOUCH_REACH
/** Keepers can use their hands: further reach, but only inside their own area. */
const KEEPER_REACH = 1.4
/**
 * How sharply a lead in the race to a ball in the air turns into winning
 * it (s): getting there first counts for less when it's a jump for it.
 */
const AERIAL_SCALE = 0.5
/** An opponent getting to a ball in the air within this distance (m) of where the receiver meets it jumps with them for it. */
const DUEL_SPAN = 2
/** Highest (m) an outfielder can get their head to a ball, and a keeper their hands. */
export const HEADER_HEIGHT = 2.7
export const KEEPER_HANDS = 2.9
/** Spacing (m) of the checks along a pass, and how far from the passer the first one is. */
const PASS_STEP = 1
const PASS_START = 1.5

const sigmoid = (x: number) => 1 / (1 + exp(-x))

/** Whether (x, y) is inside the penalty area `team` defends. */
export function inOwnArea(pitch: Pitch, team: number, x: number, y: number): boolean {
  const lineX = ownGoalX(pitch, team)
  return Math.abs(x - lineX) <= pitch.penaltyAreaDepth && Math.abs(y) <= pitch.penaltyAreaHalfWidth
}

/** Whether `eid` can get to a ball at (x, y) at all: a keeper only in their own area. */
function canContest(world: Match, eid: number, x: number, y: number): boolean {
  return !isKeeper(world, eid) || inOwnArea(world.pitch, Team.id[eid], x, y)
}

/** Every player of `team`, outfielders then the keeper. */
function playersOf(world: Match, team: number): number[] {
  const { outfielders, keeper } = world.teams[team]
  return [...outfielders, keeper]
}

/** The quickest any player of `team` gets to within `reach` of (x, y), in seconds, as `by` reckons it. */
export function teamArrival(world: Match, team: number, x: number, y: number, reach = 0, by = -1): number {
  let best = Infinity
  for (const eid of world.teams[team].outfielders) best = Math.min(best, arrivalTime(world, eid, x, y, reach, REACTION_TIME, by))
  const keeper = world.teams[team].keeper
  if (canContest(world, keeper, x, y)) best = Math.min(best, arrivalTime(world, keeper, x, y, reach, REACTION_TIME, by))
  return best
}

/**
 * Probability (0–1) that `team` gets to a ball at (x, y) before the other
 * team does: who controls that bit of the pitch.
 */
export function controlAt(world: Match, team: number, x: number, y: number): number {
  const own = teamArrival(world, team, x, y)
  const other = teamArrival(world, 1 - team, x, y)
  if (own === Infinity) return 0
  if (other === Infinity) return 1
  return sigmoid((other - own) / CONTROL_SCALE)
}

/**
 * Seconds before an opponent can get to `eid`: the time they have on the
 * ball if they get it now, as `by` reckons it.
 */
export function timeOnBall(world: Match, eid: number, by = -1): number {
  return teamArrival(world, 1 - Team.id[eid], Position.x[eid], Position.y[eid], INTERCEPT_REACH, by)
}

/**
 * Probability (0–1) that a ground pass from (fromX, fromY) to (toX, toY),
 * rolled at `speed` m/s, gets there without an opponent cutting it out.
 * At each step along the ball's path it compares when the ball arrives with
 * when each opponent could. An opponent who could be there first is likely
 * to intercept, and the pass gets through only if every opponent misses it.
 * Judged by `by`, it's against where they reckon each opponent is. Given
 * the `receiver` of a pass to feet, an opponent has to beat them to it too:
 * one marking from behind them can only challenge once it's received.
 */
export function passSafety(world: Match, team: number, fromX: number, fromY: number, toX: number, toY: number, speed: number, by = -1, receiver = -1): number {
  const length = hypot(toX - fromX, toY - fromY)
  if (length === 0) return 1
  // A pass that stops short never gets there.
  if (rollTime(speed, length) === Infinity) return 0
  // Where the ball is along its path, and when.
  let n = 0
  for (let s = Math.min(PASS_START, length); ; s = Math.min(length, s + PASS_STEP)) {
    sampleT[n] = rollTime(speed, s, n > 0 ? sampleT[n - 1] : 0)
    sampleX[n] = fromX + ((toX - fromX) * s) / length
    sampleY[n] = fromY + ((toY - fromY) * s) / length
    n++
    if (s === length) break
  }
  return pathSafety(world, team, n, by, receiver)
}

/**
 * As `passSafety`, for a pass lofted from (fromX, fromY) to land at (toX,
 * toY) `flight` seconds later, for `receiver`. Over most of its flight it's
 * out of everyone's reach: only an opponent who can get to it while it's
 * still low, near the passer, or as it drops and bounces up again, near
 * where it lands, can win it. Near the passer they block it. Coming down,
 * the receiver meets it at the first spot they can get to in time (or
 * failing that, the spot they come nearest to making). An opponent who gets
 * to it before that spot wins it; one within DUEL_SPAN of it, there with
 * them, has to win the jump for it (see `aerialDuelChance`); one beyond it
 * gets it only if the receiver doesn't. Opponents set off for it only once
 * they've judged its flight (see `flightRead`).
 */
export function loftSafety(world: Match, team: number, fromX: number, fromY: number, toX: number, toY: number, flight: number, receiver: number, by = -1): number {
  const length = hypot(toX - fromX, toY - fromY)
  if (length === 0) return 1
  const ux = (toX - fromX) / length
  const uy = (toY - fromY) / length
  const up = launchUp(flight)
  let n = 0
  const sample = (t: number, s: number, z: number) => {
    // Up there it's out of everyone's reach.
    if (z > HEADER_HEIGHT || n === MAX_SAMPLES) return
    sampleT[n] = t
    sampleX[n] = fromX + ux * s
    sampleY[n] = fromY + uy * s
    sampleZ[n] = z
    n++
  }
  for (let s = Math.min(PASS_START, length); ; s = Math.min(length, s + PASS_STEP)) {
    sample((flight * s) / length, s, heightAt(up, (flight * s) / length))
    if (s === length) break
  }
  // Not met where it lands, it bounces up and on.
  const bounceUp = up * BALL_RESTITUTION
  const bounceFlight = (2 * bounceUp) / GRAVITY
  const bounceLength = afterBounce(length / flight, up) * bounceFlight
  for (let s = PASS_STEP; s < bounceLength; s += PASS_STEP) {
    const t = (bounceFlight * s) / bounceLength
    sample(flight + t, length + s, heightAt(bounceUp, t))
  }
  const rising = (i: number) => sampleT[i] < flight / 2

  // Where the receiver meets it.
  let meet = -1
  let closest = -Infinity
  for (let i = 0; i < n; i++) {
    if (rising(i)) continue
    const lead = sampleT[i] - arrivalTime(world, receiver, sampleX[i], sampleY[i], INTERCEPT_REACH, REACTION_TIME, by)
    if (lead > closest) {
      meet = i
      closest = lead
    }
    if (lead >= 0) break
  }
  const there = meet === -1 ? 0 : sigmoid(closest / AERIAL_SCALE)

  view(world, by, receiver, receiverSeen)
  let safety = 1
  for (const eid of playersOf(world, 1 - team)) {
    const keeper = isKeeper(world, eid)
    const reach = keeper ? KEEPER_REACH : INTERCEPT_REACH
    const height = keeper ? KEEPER_HANDS : HEADER_HEIGHT
    view(world, by, eid, opponentSeen)
    const px = opponentSeen.x
    const py = opponentSeen.y
    const top = fastest(world, eid, by)
    // They set off for it once they've judged its flight.
    const reaction = keeper ? REACTION_TIME : flightRead(Outfielder.positioning[eid])
    // Their biggest lead on the ball: on its way up, coming down in front of the receiver, with them, and beyond them.
    const lead = [-Infinity, -Infinity, -Infinity, -Infinity]
    for (let i = 0; i < n; i++) {
      const group = rising(i) ? 0 : meet === -1 ? 1 : hypot(sampleX[i] - sampleX[meet], sampleY[i] - sampleY[meet]) <= DUEL_SPAN ? 2 : i < meet ? 1 : 3
      const dx = sampleX[i] - px
      const dy = sampleY[i] - py
      // No one covers ground faster than their top speed: a spot they couldn't beat the ball to even at that pace
      // can't be where they're likeliest to win it.
      if (sampleT[i] - (Math.sqrt(dx * dx + dy * dy) - reach) / top <= lead[group]) continue
      if (sampleZ[i] > height || !canContest(world, eid, sampleX[i], sampleY[i])) continue
      lead[group] = Math.max(lead[group], sampleT[i] - arrivalTime(world, eid, sampleX[i], sampleY[i], reach, reaction, by))
    }
    const wins = (l: number, scale: number) => (l > -Infinity ? sigmoid(l / scale) : 0)
    // A keeper takes it in their hands; an outfielder has to out-jump the receiver.
    const goal = ownGoalX(world.pitch, 1 - team)
    const goalSide = hypot(px - goal, py) < hypot(receiverSeen.x - goal, receiverSeen.y)
    const jump = keeper ? 1 : 1 - aerialDuelChance(Outfielder.heading[receiver], Physical.strength[receiver], Outfielder.heading[eid], Physical.strength[eid], goalSide)
    const lost = Math.max(
      wins(lead[0], INTERCEPT_SCALE),
      wins(lead[1], AERIAL_SCALE),
      wins(lead[2], AERIAL_SCALE) * (there * jump + 1 - there),
      wins(lead[3], AERIAL_SCALE) * (1 - there),
    )
    safety *= 1 - lost
  }
  return safety
}

/**
 * The chance a ball on the first `n` spots of the ground path sampled (see
 * `sampleX`) gets past every opponent.
 */
function pathSafety(world: Match, team: number, n: number, by: number, receiver: number): number {
  // The receiver comes to meet it: past the first spot they can get to before the ball, it's theirs, and an
  // opponent there with them has to beat them to it, not just the ball.
  let meet = n - 1
  let met = Infinity
  if (receiver !== -1) {
    for (let i = 0; i < n; i++) {
      const t = arrivalTime(world, receiver, sampleX[i], sampleY[i], INTERCEPT_REACH, REACTION_TIME, by)
      if (t <= sampleT[i]) {
        meet = i
        met = t
        break
      }
    }
    n = meet + 1
  }
  let safety = 1
  for (const eid of playersOf(world, 1 - team)) {
    const reach = isKeeper(world, eid) ? KEEPER_REACH : INTERCEPT_REACH
    view(world, by, eid, opponentSeen)
    const px = opponentSeen.x
    const py = opponentSeen.y
    const top = fastest(world, eid, by)
    let lead = -Infinity
    for (let i = 0; i < n; i++) {
      // No one covers ground faster than their top speed, so a spot they couldn't beat the ball to even
      // at that pace can't be where they're likeliest to cut it out.
      const dx = sampleX[i] - px
      const dy = sampleY[i] - py
      if (sampleT[i] - (Math.sqrt(dx * dx + dy * dy) - reach) / top <= lead) continue
      if (!canContest(world, eid, sampleX[i], sampleY[i])) continue
      const first = i === meet && met !== Infinity ? met : sampleT[i]
      lead = Math.max(lead, first - arrivalTime(world, eid, sampleX[i], sampleY[i], reach, REACTION_TIME, by))
    }
    if (lead > -Infinity) safety *= 1 - sigmoid(lead / INTERCEPT_SCALE)
  }
  return safety
}

const opponentSeen: View = { x: 0, y: 0, vx: 0, vy: 0, facing: 0 }
const receiverSeen: View = { x: 0, y: 0, vx: 0, vy: 0, facing: 0 }

/** The ball's path for `passSafety`: a sample a metre, so enough for any pass across the pitch. */
const MAX_SAMPLES = 200
const sampleX = new Float64Array(MAX_SAMPLES)
const sampleY = new Float64Array(MAX_SAMPLES)
const sampleT = new Float64Array(MAX_SAMPLES)
const sampleZ = new Float64Array(MAX_SAMPLES)

import { Position, Team } from '../components'
import type { Pitch } from '../pitch'
import type { Match } from '../match'
import { rollTime } from '../passing'
import { ownGoalX } from '../teams'
import { FOOT_OFFSET, TOUCH_REACH } from '../touch'
import { view, type View } from '../perception'
import { arrivalTime, fastest, isKeeper, REACTION_TIME } from './arrival'

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
/** Spacing (m) of the checks along a pass, and how far from the passer the first one is. */
const PASS_STEP = 1
const PASS_START = 1.5

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

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
 * Judged by `by`, it's against where they reckon each opponent is.
 */
export function passSafety(world: Match, team: number, fromX: number, fromY: number, toX: number, toY: number, speed: number, by = -1): number {
  const length = Math.hypot(toX - fromX, toY - fromY)
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
      if (canContest(world, eid, sampleX[i], sampleY[i])) lead = Math.max(lead, sampleT[i] - arrivalTime(world, eid, sampleX[i], sampleY[i], reach, REACTION_TIME, by))
    }
    if (lead > -Infinity) safety *= 1 - sigmoid(lead / INTERCEPT_SCALE)
  }
  return safety
}

const opponentSeen: View = { x: 0, y: 0, vx: 0, vy: 0, facing: 0 }

/** The ball's path for `passSafety`: a sample a metre, so enough for any pass across the pitch. */
const MAX_SAMPLES = 200
const sampleX = new Float64Array(MAX_SAMPLES)
const sampleY = new Float64Array(MAX_SAMPLES)
const sampleT = new Float64Array(MAX_SAMPLES)

import { hasComponent, query } from 'bitecs'
import { Goalkeeper, Position, Team } from '../components'
import { PENALTY_AREA_DEPTH, PENALTY_AREA_HALF_WIDTH } from '../constants'
import type { Match } from '../match'
import { rollTime } from '../passing'
import { ownGoalX } from '../teams'
import { FOOT_OFFSET, TOUCH_REACH } from '../touch'
import { arrivalTime } from './arrival'

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
export function inOwnArea(team: number, x: number, y: number): boolean {
  const lineX = ownGoalX(team)
  return Math.abs(x - lineX) <= PENALTY_AREA_DEPTH && Math.abs(y) <= PENALTY_AREA_HALF_WIDTH
}

/** Whether `eid` can get to a ball at (x, y) at all: a keeper only in their own area. */
function canContest(world: Match, eid: number, x: number, y: number): boolean {
  return !hasComponent(world, eid, Goalkeeper) || inOwnArea(Team.id[eid], x, y)
}

/** The quickest any player of `team` gets to within `reach` of (x, y), in seconds. */
export function teamArrival(world: Match, team: number, x: number, y: number, reach = 0): number {
  let best = Infinity
  for (const eid of query(world, [Team, Position])) {
    if (Team.id[eid] !== team || !canContest(world, eid, x, y)) continue
    best = Math.min(best, arrivalTime(world, eid, x, y, reach))
  }
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
 * ball if they get it now.
 */
export function timeOnBall(world: Match, eid: number): number {
  return teamArrival(world, 1 - Team.id[eid], Position.x[eid], Position.y[eid], INTERCEPT_REACH)
}

/**
 * Probability (0–1) that a ground pass from (fromX, fromY) to (toX, toY),
 * rolled at `speed` m/s, gets there without an opponent cutting it out.
 * At each step along the ball's path it compares when the ball arrives with
 * when each opponent could. An opponent who could be there first is likely
 * to intercept, and the pass gets through only if every opponent misses it.
 */
export function passSafety(world: Match, team: number, fromX: number, fromY: number, toX: number, toY: number, speed: number): number {
  const length = Math.hypot(toX - fromX, toY - fromY)
  if (length === 0) return 1
  // A pass that stops short never gets there.
  if (rollTime(speed, length) === Infinity) return 0
  // Where the ball is along its path, and when.
  const samples: { x: number; y: number; t: number }[] = []
  for (let i = 0; ; i++) {
    const s = Math.min(length, Math.min(PASS_START, length) + i * PASS_STEP)
    const t = rollTime(speed, s)
    samples.push({ x: fromX + ((toX - fromX) * s) / length, y: fromY + ((toY - fromY) * s) / length, t })
    if (s === length) break
  }
  let safety = 1
  for (const eid of query(world, [Team, Position])) {
    if (Team.id[eid] === team) continue
    const reach = hasComponent(world, eid, Goalkeeper) ? KEEPER_REACH : INTERCEPT_REACH
    let lead = -Infinity
    for (const { x, y, t } of samples) {
      if (canContest(world, eid, x, y)) lead = Math.max(lead, t - arrivalTime(world, eid, x, y, reach))
    }
    if (lead > -Infinity) safety *= 1 - sigmoid(lead / INTERCEPT_SCALE)
  }
  return safety
}

import { angleDelta } from '../angles'
import { Facing, Mark, OffBall, Outfielder, Position } from '../components'
import { assign } from '../assignment'
import { trapChance } from '../grades'
import type { Match } from '../match'
import { along, baseLine, LINE_LIMITS, onsideLimit } from '../shape'
import { arrivalTime } from '../space/arrival'
import { timeOnBall } from '../space/control'
import { threat } from '../space/threat'
import { attackDir, opponent, ownGoalX } from '../teams'
import { PITCH_HALF_WIDTH } from '../constants'

/** Share out marking jobs this often (s): several times a second, like defenders talking. */
const MARKING_EVERY = 0.3
/**
 * Seconds of arrival-time advantage another defender needs before taking a
 * man over from the one already marking him: "pass him on" only happens
 * when the new marker is clearly better placed.
 */
const HANDOVER = 0.5
/** Seconds of arrival time it's worth to pick up the more dangerous attacker, per unit of threat. */
const DANGER = 2
/** A marker aims to stand this far (m) goal-side of their man. */
const MARK_GAP = 2

// The line drops off this far (m) when the carrier can play forward, and steps
// up this far when they can't, moving at these speeds (m/s).
const DROP = 4
const STEP_UP = 5
const DROP_SPEED = 4
const STEP_SPEED = 3
/** Never step up nearer the ball than this (m). */
const STEP_UP_SHORT_OF_BALL = 3
/** A carrier with this long (s) on the ball, facing within FORWARD (rad) of goal, can play forward. */
const TIME_TO_PLAY = 0.8
const FORWARD = 1.1
/** Facing further than this (rad) from goal, a carrier is facing their own. */
const FACING_BACK = 1.9
/** Within this distance (m) of a touchline, the carrier is pinned there. */
const TOUCHLINE = 3
/** Springing the trap, the line steps up this far (m) at this speed (m/s), and holds it this long (s) after the strike. */
const TRAP_STEP = 2.5
const TRAP_SPEED = 5
const TRAP_HOLD = 0.3
/** An attacker within this distance (m) of the line is lurking on it. */
const LURKING = 2
/** Seconds before defenders react to the trap being sprung. */
const TRAP_REACTION = 0.08

/**
 * The defending team's shared decisions: where its line is, and who marks
 * whom. The line moves as one, dropping off when the carrier can play
 * forward and stepping up on a pressing cue. The jobs are shared out by an
 * optimal assignment, so no two defenders take the same man.
 */
export function defendingSystem(world: Match, dt: number) {
  if (world.phase === 'stopped') return
  for (const team of [0, 1]) {
    moveLine(world, team, dt)
    if (world.time >= world.nextMarking[team]) {
      world.nextMarking[team] = world.time + MARKING_EVERY
      shareMarking(world, team)
    }
  }
}

/** Where the line should be now, in the defending team's `along` terms. */
export function lineTarget(world: Match, team: number): number {
  const base = baseLine(world, team)
  if (team === world.possession || world.phase !== 'play') return base
  const ballU = along(team, Position.x[world.ball])
  if (trapping(world, team)) return Math.min(world.lines[team] + TRAP_STEP, ballU - STEP_UP_SHORT_OF_BALL)
  if (canPlayForward(world)) return Math.max(LINE_LIMITS.deepest, base - DROP)
  if (pressCue(world)) return Math.min(base + STEP_UP, ballU - STEP_UP_SHORT_OF_BALL, LINE_LIMITS.highest + STEP_UP)
  return base
}

/** Moves the line towards where it should be, as a unit, no faster than defenders shuffle up or back. */
function moveLine(world: Match, team: number, dt: number) {
  const target = lineTarget(world, team)
  const line = world.lines[team]
  const speed = trapping(world, team) ? TRAP_SPEED : target > line ? STEP_SPEED : DROP_SPEED
  world.lines[team] = line + Math.max(-speed * dt, Math.min(speed * dt, target - line))
}

/** Whether `team` is springing the offside trap right now. */
export function trapping(world: Match, team: number): boolean {
  return world.time < world.trap[team]
}

/**
 * The carrier is shaping to pass. If an attacker is lurking on the line, the
 * defending team may step up together as it's played, to leave them
 * offside: the better their positioning, the more often they try it. They
 * move as soon as they see it.
 */
export function maybeSpringTrap(world: Match, windup: number) {
  const team = opponent(world.possession)
  // The real line: where the second-last defender actually is, as the attackers see it.
  const limit = onsideLimit(world, world.possession)
  const lurking = world.teams[world.possession].outfielders.some((a) => {
    if (a === world.carrier) return false
    const gap = limit - along(world.possession, Position.x[a])
    return gap >= 0 && gap <= LURKING
  })
  if (!lurking) return
  const defenders = world.teams[team].outfielders
  const positioning = defenders.reduce((sum, d) => sum + Outfielder.positioning[d], 0) / defenders.length
  if (world.rng() >= trapChance(positioning)) return
  world.trap[team] = world.time + windup + TRAP_HOLD
  for (const d of defenders) if (d !== world.presser) OffBall.decideIn[d] = Math.min(OffBall.decideIn[d], TRAP_REACTION)
}

/** Whether the carrier has the time and the body shape to play forward. */
export function canPlayForward(world: Match): boolean {
  if (world.pass) return false
  const carrier = world.carrier
  const forward = attackDir(world.possession) > 0 ? 0 : Math.PI
  return timeOnBall(world, carrier) >= TIME_TO_PLAY && Math.abs(angleDelta(Facing.angle[carrier], forward)) <= FORWARD
}

/**
 * A moment to press as a team: the carrier facing their own goal, pinned on
 * a touchline, or the ball just played backwards.
 */
export function pressCue(world: Match): boolean {
  const carrier = world.carrier
  const team = world.possession
  const forward = attackDir(team) > 0 ? 0 : Math.PI
  if (world.pass) return along(team, world.pass.x) < along(team, Position.x[world.pass.from]) - 3
  return Math.abs(angleDelta(Facing.angle[carrier], forward)) > FACING_BACK || Math.abs(Position.y[world.ball]) > PITCH_HALF_WIDTH - TOUCHLINE
}

/**
 * Shares the marking out. The presser has the carrier. Everyone else on the
 * team is assigned an attacker so the total time to get goal-side of them is
 * least, weighted to the more dangerous ones. A defender already on a man
 * keeps him unless another is clearly better placed. While the keeper holds
 * the ball, every attacker is picked up.
 */
function shareMarking(world: Match, team: number) {
  const defenders = world.teams[team].outfielders
  if (team === world.possession) {
    for (const d of defenders) Mark.target[d] = -1
    return
  }
  const held = world.phase === 'held'
  const free = defenders.filter((d) => held || d !== world.presser)
  const attackers = world.teams[world.possession].outfielders.filter((a) => held || a !== world.carrier)
  if (!held) Mark.target[world.presser] = world.carrier
  const goalX = ownGoalX(team)
  const cost = free.map((d) =>
    attackers.map((a) => {
      const ax = Position.x[a]
      const ay = Position.y[a]
      const length = Math.hypot(goalX - ax, ay) || 1
      const x = ax + ((goalX - ax) / length) * MARK_GAP
      const y = ay + (-ay / length) * MARK_GAP
      const danger = threat(opponent(team), ax, ay)
      return arrivalTime(world, d, x, y) - DANGER * danger - (Mark.target[d] === a ? HANDOVER : 0)
    }),
  )
  const jobs = assign(cost)
  free.forEach((d, i) => (Mark.target[d] = jobs[i] === -1 ? -1 : attackers[jobs[i]]))
}

import { angleDelta } from '../angles'
import { Facing, Mark, Outfielder, Position } from '../components'
import { assign } from '../assignment'
import { cue } from '../cues'
import { trapChance } from '../grades'
import type { Match } from '../match'
import { along, baseLine, homePosition, LINE_LIMITS, onsideLimit } from '../shape'
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
/**
 * Seconds of arrival time it's worth to have someone covering the presser:
 * pressure without cover just gets beaten, so it's filled before all but
 * the most dangerous man.
 */
const COVER_PRIORITY = 1
/**
 * Seconds of arrival time per metre an attacker is from a defender's place
 * in the shape: each defender looks after the men in and around their own
 * zone, so the block keeps its shape rather than being dragged about.
 */
const ZONE_COST = 1 / 7
/** The cover sits this far (m) behind the ball, towards the middle of the goal. */
const COVER_DEPTH = 5.5

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
  cue(world, { kind: 'trap', team })
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
 * Where the presser's cover stands: behind the ball, between it and the
 * middle of the goal, to step in if the presser is beaten.
 */
export function coverSpot(world: Match, team: number) {
  const goalX = ownGoalX(team)
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  const length = Math.hypot(goalX - bx, by) || 1
  return { x: bx + ((goalX - bx) / length) * COVER_DEPTH, y: by + (-by / length) * COVER_DEPTH }
}

/**
 * Shares the jobs out, as defenders talk to each other: pressure, cover,
 * and men picked up. The presser has the carrier. Of everyone else, one
 * covers behind the presser, and the rest pick up the attackers in and
 * around their zones, the more dangerous first, so the total time to get
 * into position is least. With more defenders than jobs, the spare ones
 * hold their zones, which is the balance on the far side; a lone defender
 * behind the presser covers and marks at once. A defender keeps
 * their job unless another is clearly better placed. While the keeper holds
 * the ball there's no presser to cover, and every attacker is picked up.
 */
function shareMarking(world: Match, team: number) {
  const defenders = world.teams[team].outfielders
  if (team === world.possession || world.phase === 'held') for (const d of defenders) Mark.cover[d] = 0
  if (team === world.possession) {
    for (const d of defenders) Mark.target[d] = -1
    return
  }
  if (world.phase !== 'held') Mark.cover[world.presser] = 0
  const held = world.phase === 'held'
  const free = defenders.filter((d) => held || d !== world.presser)
  const attackers = world.teams[world.possession].outfielders.filter((a) => held || a !== world.carrier)
  if (!held) Mark.target[world.presser] = world.carrier
  const goalX = ownGoalX(team)
  const cover = coverSpot(world, team)
  const coverJob = !held && free.length > 1
  const cost = free.map((d) => {
    const home = homePosition(world, d)
    const men = attackers.map((a) => {
      const ax = Position.x[a]
      const ay = Position.y[a]
      const length = Math.hypot(goalX - ax, ay) || 1
      const x = ax + ((goalX - ax) / length) * MARK_GAP
      const y = ay + (-ay / length) * MARK_GAP
      const danger = threat(opponent(team), ax, ay)
      const zone = ZONE_COST * Math.hypot(ax - home.x, ay - home.y)
      return arrivalTime(world, d, x, y) + zone - DANGER * danger - (Mark.target[d] === a ? HANDOVER : 0)
    })
    if (!coverJob) return men
    return [...men, arrivalTime(world, d, cover.x, cover.y) - COVER_PRIORITY - (Mark.cover[d] ? HANDOVER : 0)]
  })
  const jobs = assign(cost)
  free.forEach((d, i) => {
    Mark.target[d] = jobs[i] === -1 || jobs[i] === attackers.length ? -1 : attackers[jobs[i]]
    // A lone defender behind the presser has to cover and mark at once.
    Mark.cover[d] = !held && (!coverJob || jobs[i] === attackers.length) ? 1 : 0
  })
}

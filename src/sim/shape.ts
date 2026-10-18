import { query } from 'bitecs'
import { Position, Slot, Team } from './components'
import { PITCH_HALF_LENGTH, PITCH_HALF_WIDTH } from './constants'
import { formationFor } from './formation'
import type { Match } from './match'
import { attackDir, opponent } from './teams'

const L = PITCH_HALF_LENGTH
const W = PITCH_HALF_WIDTH
const LENGTH = 2 * L

// With the ball: the block's back edge sits this far behind the ball, between
// these limits, and its front edge this far onside of the opposition's line.
const REST_BEHIND_BALL = 0.2 * LENGTH
const REST_DEEPEST = -L + 0.2 * LENGTH
const ONSIDE_MARGIN = 1
/** The front edge never goes nearer the goal line than this (m). */
const FRONT_FROM_GOAL = 0.08 * LENGTH
const MIN_BLOCK_LENGTH = 0.16 * LENGTH
const ATTACK_HALF_WIDTH = W - 3
const ATTACK_BALL_SHIFT = 0.25

// Without the ball: the back line sits this far behind the ball, between these
// limits, and the block is this long, this wide, and shifts this much with the ball.
const LINE_BEHIND_BALL = 0.25 * LENGTH
const LINE_DEEPEST = -L + 0.15 * LENGTH
const LINE_HIGHEST = -0.05 * LENGTH
const DEFEND_LENGTH = 0.3 * LENGTH
const DEFEND_HALF_WIDTH = 0.55 * W
const DEFEND_BALL_SHIFT = 0.6

/** Keep homes this far inside the lines. */
const EDGE_MARGIN = 1.5

/** How far up the pitch `x` is for `team`: -L at their own goal line, +L at the one they attack. */
export const along = (team: number, x: number) => x * attackDir(team)

/**
 * The furthest up the pitch (in `along` terms) a player of `team` can stand
 * without being offside: level with the second-last opponent, or with the
 * ball if it is further forward, and never short of the halfway line.
 */
export function onsideLimit(world: Match, team: number): number {
  const depths: number[] = []
  for (const eid of query(world, [Team, Position])) {
    if (Team.id[eid] === opponent(team)) depths.push(along(team, Position.x[eid]))
  }
  depths.sort((a, b) => b - a)
  const secondLast = depths.length >= 2 ? depths[1] : L
  return Math.max(secondLast, along(team, Position.x[world.ball]), 0)
}

/**
 * Where `team`'s defensive line would sit with nothing else going on: a
 * fixed distance behind the ball, between its deepest and highest limits.
 * The defending system moves the actual line towards this, adjusted for
 * stepping up and dropping off.
 */
export function baseLine(world: Match, team: number): number {
  return clamp(along(team, Position.x[world.ball]) - LINE_BEHIND_BALL, LINE_DEEPEST, LINE_HIGHEST)
}

/** The deepest and highest the line goes, in `along` terms. */
export const LINE_LIMITS = { deepest: LINE_DEEPEST, highest: LINE_HIGHEST }

/** The rectangle `team`'s outfielders arrange themselves in, in `along` terms for depth. */
export function block(world: Match, team: number) {
  const ballU = along(team, Position.x[world.ball])
  const ballY = Position.y[world.ball]
  if (team === world.possession) {
    const front = Math.min(onsideLimit(world, team) - ONSIDE_MARGIN, L - FRONT_FROM_GOAL)
    const back = Math.min(clamp(ballU - REST_BEHIND_BALL, REST_DEEPEST, 0), front - MIN_BLOCK_LENGTH)
    return { back, front, centreY: ballY * ATTACK_BALL_SHIFT, halfWidth: ATTACK_HALF_WIDTH }
  }
  const back = world.lines[team]
  const room = W - DEFEND_HALF_WIDTH
  return { back, front: back + DEFEND_LENGTH, centreY: clamp(ballY * DEFEND_BALL_SHIFT, -room, room), halfWidth: DEFEND_HALF_WIDTH }
}

/**
 * Where `eid` belongs in their team's shape right now: their formation slot
 * mapped into the block. It's where they drift back to with nothing else to do.
 */
export function homePosition(world: Match, eid: number) {
  const team = Team.id[eid]
  const formation = formationFor(world.teams[team].outfielders.length)
  const slots = team === world.possession ? formation.inPossession : formation.outOfPossession
  const slot = slots[Slot.index[eid]]
  const b = block(world, team)
  const u = b.back + slot.depth * (b.front - b.back)
  // A team attacking -x sees the pitch the other way round, so its left is +y.
  const y = b.centreY + slot.width * b.halfWidth * attackDir(team)
  return {
    x: clamp(u, -L + EDGE_MARGIN, L - EDGE_MARGIN) * attackDir(team),
    y: clamp(y, -W + EDGE_MARGIN, W - EDGE_MARGIN),
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

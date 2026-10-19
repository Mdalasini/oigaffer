import { Position, Slot, Team } from './components'
import { formationFor } from './formation'
import type { Match } from './match'
import { seenX } from './perception'
import { perPitch, type Pitch } from './pitch'
import { attackDir, opponent } from './teams'

// With the ball, sizes are shares of the pitch's length and width: an attack
// stretches whatever pitch it has. Without it, the back line and the block are
// set in metres from the ball and the goal: how close a defence has to be to
// the ball, and how compact it is, don't grow with the pitch.
const dimensions = perPitch(({ halfLength: L, halfWidth: W }: Pitch) => {
  const LENGTH = 2 * L
  return {
    L,
    W,
    // With the ball: the block's back edge sits this far behind the ball, between
    // these limits, and its front edge this far onside of the opposition's line.
    REST_BEHIND_BALL: 0.2 * LENGTH,
    REST_DEEPEST: -L + 0.2 * LENGTH,
    /** The front edge never goes nearer the goal line than this (m). */
    FRONT_FROM_GOAL: 0.08 * LENGTH,
    MIN_BLOCK_LENGTH: 0.16 * LENGTH,
    ATTACK_HALF_WIDTH: W - 3,
    // Without the ball: the back line sits LINE_BEHIND_BALL behind the ball, no
    // deeper than LINE_DEEPEST_FROM_GOAL off its own goal line and no higher
    // than this, and the block is this wide.
    LINE_DEEPEST: -L + LINE_DEEPEST_FROM_GOAL,
    LINE_HIGHEST: -0.05 * LENGTH,
    DEFEND_HALF_WIDTH: 0.55 * W,
  }
})

/** Without the ball, the back line sits this far (m) behind the ball... */
const LINE_BEHIND_BALL = 15
/** ...and no nearer its own goal line than this (m): about the edge of the six-yard box on a full-size pitch. */
const LINE_DEEPEST_FROM_GOAL = 9
/** From the back line to the front of the block without the ball (m). */
const DEFEND_LENGTH = 18
/**
 * ...but the front of the block is never more than this far (m) ahead of the
 * ball: with the ball in behind the line, down by the goal line, the screen
 * drops to the edge of the box rather than leaving the space in front of
 * the line to the attackers. The block keeps at least this depth (m).
 */
const DEFEND_FRONT_AHEAD_OF_BALL = 12
const MIN_DEFEND_LENGTH = 8

const ONSIDE_MARGIN = 1
const ATTACK_BALL_SHIFT = 0.25
/** Without the ball, the block shifts this much with the ball. */
const DEFEND_BALL_SHIFT = 0.6

/** Keep homes this far inside the lines. */
const EDGE_MARGIN = 1.5

/** How far up the pitch `x` is for `team`: -L at their own goal line, +L at the one they attack. */
export const along = (team: number, x: number) => x * attackDir(team)

/**
 * The furthest up the pitch (in `along` terms) a player of `team` can stand
 * without being offside: level with the second-last opponent, or with the
 * ball if it is further forward, and never short of the halfway line. Judged
 * by `by`, it's against where they last saw each opponent (see `perception`).
 */
export function onsideLimit(world: Match, team: number, by = -1): number {
  // The two opponents nearest their own goal line, keeper included.
  const { outfielders, keeper } = world.teams[opponent(team)]
  let last = along(team, seenX(world, by, keeper))
  let secondLast = -Infinity
  for (const eid of outfielders) {
    const u = along(team, seenX(world, by, eid))
    if (u > last) {
      secondLast = last
      last = u
    } else if (u > secondLast) secondLast = u
  }
  if (secondLast === -Infinity) secondLast = world.pitch.halfLength
  return Math.max(secondLast, along(team, Position.x[world.ball]), 0)
}

/**
 * Where `team`'s defensive line would sit with nothing else going on: a
 * fixed distance behind the ball, between its deepest and highest limits.
 * The defending system moves the actual line towards this, adjusted for
 * stepping up and dropping off.
 */
export function baseLine(world: Match, team: number): number {
  const { LINE_DEEPEST, LINE_HIGHEST } = dimensions(world.pitch)
  return clamp(along(team, Position.x[world.ball]) - LINE_BEHIND_BALL, LINE_DEEPEST, LINE_HIGHEST)
}

/** The deepest and highest the line goes on `pitch`, in `along` terms. */
export function lineLimits(pitch: Pitch) {
  const { LINE_DEEPEST, LINE_HIGHEST } = dimensions(pitch)
  return { deepest: LINE_DEEPEST, highest: LINE_HIGHEST }
}

/** The rectangle `team`'s outfielders arrange themselves in, in `along` terms for depth. */
export function block(world: Match, team: number) {
  const d = dimensions(world.pitch)
  const ballU = along(team, Position.x[world.ball])
  const ballY = Position.y[world.ball]
  if (team === world.possession) {
    const front = Math.min(onsideLimit(world, team) - ONSIDE_MARGIN, d.L - d.FRONT_FROM_GOAL)
    const back = Math.min(clamp(ballU - d.REST_BEHIND_BALL, d.REST_DEEPEST, 0), front - d.MIN_BLOCK_LENGTH)
    return { back, front, centreY: ballY * ATTACK_BALL_SHIFT, halfWidth: d.ATTACK_HALF_WIDTH }
  }
  const back = world.lines[team]
  const room = d.W - d.DEFEND_HALF_WIDTH
  const front = clamp(ballU + DEFEND_FRONT_AHEAD_OF_BALL, back + MIN_DEFEND_LENGTH, back + DEFEND_LENGTH)
  return { back, front, centreY: clamp(ballY * DEFEND_BALL_SHIFT, -room, room), halfWidth: d.DEFEND_HALF_WIDTH }
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
  const { halfLength: L, halfWidth: W } = world.pitch
  return {
    x: clamp(u, -L + EDGE_MARGIN, L - EDGE_MARGIN) * attackDir(team),
    y: clamp(y, -W + EDGE_MARGIN, W - EDGE_MARGIN),
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

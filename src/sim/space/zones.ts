import type { Pitch } from '../pitch'
import { attackDir } from '../teams'

/**
 * The zones coaches divide a pitch into: five lanes running its length (two
 * wide, two half-spaces, the centre) and six bands across it. They are for
 * decisions, such as which area a role lives in or which spots are worth
 * looking at, not for exact positions.
 *
 * The lane edges sit where the edges of the goal area and the penalty area
 * fall on a full-size pitch, as fractions of its half-width, so the lanes keep
 * their shape on any pitch.
 */
export const LANES = 5
export const BANDS = 6
const LANE_EDGES = [0.27, 0.59]

/** Lane 0 is the wide lane on the -y side, 2 the centre, 4 the wide lane on the +y side. */
export function laneOf(pitch: Pitch, y: number): number {
  const t = Math.abs(y) / pitch.halfWidth
  const fromCentre = t < LANE_EDGES[0] ? 0 : t < LANE_EDGES[1] ? 1 : 2
  return 2 + Math.sign(y) * fromCentre
}

/** The y range [lo, hi] a lane covers. */
export function laneSpan(pitch: Pitch, lane: number): [number, number] {
  const edges = [-1, -LANE_EDGES[1], -LANE_EDGES[0], LANE_EDGES[0], LANE_EDGES[1], 1].map((t) => t * pitch.halfWidth)
  return [edges[lane], edges[lane + 1]]
}

/** Band 0 runs up from `team`'s own goal line, band 5 ends at the goal line they attack. */
export function bandOf(pitch: Pitch, x: number, team: number): number {
  const depth = (x * attackDir(team) + pitch.halfLength) / (2 * pitch.halfLength)
  return Math.min(BANDS - 1, Math.max(0, Math.floor(depth * BANDS)))
}

/** The x range [lo, hi] a band covers, for `team`. */
export function bandSpan(pitch: Pitch, band: number, team: number): [number, number] {
  const length = (2 * pitch.halfLength) / BANDS
  const a = (-pitch.halfLength + band * length) * attackDir(team)
  const b = (-pitch.halfLength + (band + 1) * length) * attackDir(team)
  return [Math.min(a, b), Math.max(a, b)]
}

export function zoneCentre(pitch: Pitch, lane: number, band: number, team: number) {
  const [y0, y1] = laneSpan(pitch, lane)
  const [x0, x1] = bandSpan(pitch, band, team)
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
}

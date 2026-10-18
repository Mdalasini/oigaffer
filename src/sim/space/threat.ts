import { GOAL_HALF_WIDTH } from '../constants'
import { perPitch, type Pitch } from '../pitch'
import { attackDir } from '../teams'

/**
 * The chance (0–1) that a shot from (x, y) at the goal on +x of `pitch` goes in, from
 * how far out it is and how much of the goal mouth it can see. A typical
 * expected-goals shape: about 0.6 from 6 m out in the middle, 0.25 from the
 * penalty spot, under 0.1 from 20 m.
 */
export function shotChance(pitch: Pitch, x: number, y: number): number {
  const dx = pitch.halfLength - x
  if (dx <= 0) return 0
  const distance = Math.hypot(dx, y)
  // The angle between the lines to the two posts.
  const angle = Math.abs(Math.atan2(GOAL_HALF_WIDTH - y, dx) - Math.atan2(-GOAL_HALF_WIDTH - y, dx))
  return 1 / (1 + Math.exp(-(-1.2 + 1.9 * angle - 0.09 * distance)))
}

/** Grid spacing (m) of the threat map. */
const CELL = 1
/**
 * Share of a spot's value kept per metre of travel to it. Having the ball is
 * worth a discounted share of the best shot it can be carried or passed to.
 */
const KEEP_PER_METRE = 0.9
/**
 * Having the ball anywhere in the middle is worth at least this, rising in
 * a straight line from OWN_GOAL_VALUE at a team's own goal line to
 * HALFWAY_VALUE at halfway and on: about what a possession there goes on to score in real
 * matches (expected threat, as Karun Singh measured it), where the chance
 * of a shot it leads to straight away is next to nothing.
 */
const OWN_GOAL_VALUE = 0.005
const HALFWAY_VALUE = 0.012
/** Out on a touchline, that floor is this share lower than in the middle. */
const WIDE_FLOOR_DISCOUNT = 0.2

/** Each pitch's threat map, built the first time it's needed. */
const threatMap = perPitch(buildMap)

/**
 * Expected threat: how dangerous it is for `team` to have the ball at (x, y).
 * It is the best shot chance reachable from there, discounted by the distance
 * to it, so it rises towards goal and towards the middle and is never below
 * the chance of shooting from the spot itself.
 */
export function threat(pitch: Pitch, team: number, x: number, y: number): number {
  const map = threatMap(pitch)
  // The grid is built for attacking +x; mirror it for the other team.
  const gx = (x * attackDir(team) + pitch.halfLength) / CELL
  const gy = (y + pitch.halfWidth) / CELL
  return bilinear(map, clamp(gx, 0, map.nx - 1), clamp(gy, 0, map.ny - 1))
}

interface ThreatMap {
  g: Float32Array
  nx: number
  ny: number
}

function buildMap(pitch: Pitch): ThreatMap {
  const NX = Math.round((2 * pitch.halfLength) / CELL) + 1
  const NY = Math.round((2 * pitch.halfWidth) / CELL) + 1
  const g = new Float32Array(NX * NY)
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NY; j++) g[i * NY + j] = shotChance(pitch, -pitch.halfLength + i * CELL, -pitch.halfWidth + j * CELL)
  }
  // Spread each value to its neighbours, discounted by distance, until nothing changes:
  // a forward sweep and a backward sweep each pass, like a distance transform.
  const straight = KEEP_PER_METRE ** CELL
  const diagonal = KEEP_PER_METRE ** (CELL * Math.SQRT2)
  const forward: [number, number, number][] = [
    [-1, -1, diagonal],
    [-1, 0, straight],
    [-1, 1, diagonal],
    [0, -1, straight],
  ]
  const backward = forward.map(([di, dj, k]): [number, number, number] => [-di, -dj, k])
  for (let pass = 0; pass < 50; pass++) {
    let changed = false
    for (const [order, steps] of [
      [1, forward],
      [-1, backward],
    ] as const) {
      for (let n = 0; n < NX * NY; n++) {
        const cell = order === 1 ? n : NX * NY - 1 - n
        const i = Math.floor(cell / NY)
        const j = cell % NY
        for (const [di, dj, k] of steps) {
          const a = i + di
          const b = j + dj
          if (a < 0 || a >= NX || b < 0 || b >= NY) continue
          const v = g[a * NY + b] * k
          if (v > g[cell] + 1e-7) {
            g[cell] = v
            changed = true
          }
        }
      }
    }
    if (!changed) break
  }
  for (let i = 0; i < NX; i++) {
    const floor = OWN_GOAL_VALUE + (HALFWAY_VALUE - OWN_GOAL_VALUE) * (i * CELL) / pitch.halfLength
    for (let j = 0; j < NY; j++) {
      const wide = Math.abs(-pitch.halfWidth + j * CELL) / pitch.halfWidth
      g[i * NY + j] = Math.max(g[i * NY + j], floor * (1 - WIDE_FLOOR_DISCOUNT * wide))
    }
  }
  return { g, nx: NX, ny: NY }
}

function bilinear({ g, nx: NX, ny: NY }: ThreatMap, x: number, y: number): number {
  const i = Math.min(NX - 2, Math.floor(x))
  const j = Math.min(NY - 2, Math.floor(y))
  const fx = x - i
  const fy = y - j
  const at = (a: number, b: number) => g[a * NY + b]
  return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

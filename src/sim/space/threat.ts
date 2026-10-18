import { GOAL_HALF_WIDTH, GOAL_X, PITCH_HALF_LENGTH, PITCH_HALF_WIDTH } from '../constants'
import { attackDir } from '../teams'

/**
 * The chance (0–1) that a shot from (x, y) at the goal on +x goes in, from
 * how far out it is and how much of the goal mouth it can see. A typical
 * expected-goals shape: about 0.6 from 6 m out in the middle, 0.25 from the
 * penalty spot, under 0.1 from 20 m.
 */
export function shotChance(x: number, y: number): number {
  const dx = GOAL_X - x
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

const NX = Math.round((2 * PITCH_HALF_LENGTH) / CELL) + 1
const NY = Math.round((2 * PITCH_HALF_WIDTH) / CELL) + 1
let grid: Float32Array | null = null

/**
 * Expected threat: how dangerous it is for `team` to have the ball at (x, y).
 * It is the best shot chance reachable from there, discounted by the distance
 * to it, so it rises towards goal and towards the middle and is never below
 * the chance of shooting from the spot itself.
 */
export function threat(team: number, x: number, y: number): number {
  const g = (grid ??= buildGrid())
  // The grid is built for attacking +x; mirror it for the other team.
  const gx = (x * attackDir(team) + PITCH_HALF_LENGTH) / CELL
  const gy = (y + PITCH_HALF_WIDTH) / CELL
  return bilinear(g, clamp(gx, 0, NX - 1), clamp(gy, 0, NY - 1))
}

function buildGrid(): Float32Array {
  const g = new Float32Array(NX * NY)
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NY; j++) g[i * NY + j] = shotChance(-PITCH_HALF_LENGTH + i * CELL, -PITCH_HALF_WIDTH + j * CELL)
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
  return g
}

function bilinear(g: Float32Array, x: number, y: number): number {
  const i = Math.min(NX - 2, Math.floor(x))
  const j = Math.min(NY - 2, Math.floor(y))
  const fx = x - i
  const fy = y - j
  const at = (a: number, b: number) => g[a * NY + b]
  return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

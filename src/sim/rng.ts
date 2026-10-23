// Seeded PRNG (mulberry32). State is a single uint32 held in a plain object so
// it snapshots and restores with the rest of the sim state.

export interface Rng {
  s: number
}

export function createRng(seed: number): Rng {
  return { s: seed >>> 0 }
}

/** Uniform in [0, 1). */
export function next(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0
  let t = r.s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function range(r: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * next(r)
}

/** Integer in [lo, hi]. */
export function int(r: Rng, lo: number, hi: number): number {
  return lo + Math.floor(next(r) * (hi - lo + 1))
}

export function chance(r: Rng, p: number): boolean {
  return next(r) < p
}

/** Approximately normal (Irwin–Hall, 4 draws), mean 0, std dev 1. */
export function gauss(r: Rng): number {
  return (next(r) + next(r) + next(r) + next(r) - 2) * 1.7320508075688772
}

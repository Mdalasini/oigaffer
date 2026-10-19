/** A seeded random number source; `state` is all it remembers, so copying it rewinds the sequence. */
export type Rng = (() => number) & { state: number }

/** Standard normal sample (Box–Muller). */
export function gaussian(rng: Rng): number {
  const u = 1 - rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/** Small seeded PRNG (mulberry32) so matches can be replayed and tested. */
export function createRng(seed: number): Rng {
  const rng = (() => {
    rng.state = (rng.state + 0x6d2b79f5) >>> 0
    let t = rng.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }) as Rng
  rng.state = seed >>> 0
  return rng
}

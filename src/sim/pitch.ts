/**
 * A pitch: its size and markings, in metres. Each match plays on one (see
 * `world.pitch`), so a small-sided game and 11v11 each get a pitch that suits
 * them. The goals are full size on every pitch (see `constants`).
 *
 * World space is centred on the centre spot, so the goal lines are at
 * ±`halfLength` and the touchlines at ±`halfWidth`.
 */
export interface Pitch {
  /** Centre spot to goal line: the x of the goal line attacked by the team attacking +x. */
  readonly halfLength: number
  /** Centre spot to touchline. */
  readonly halfWidth: number
  readonly penaltyAreaDepth: number
  readonly penaltyAreaHalfWidth: number
  readonly goalAreaDepth: number
  readonly goalAreaHalfWidth: number
  /** Goal line to penalty spot. */
  readonly penaltySpotDistance: number
  readonly circleRadius: number
  /** How far opponents stand from a free kick. */
  readonly freeKickDistance: number
}

/**
 * For four outfielders and a keeper a side: 60 m by 40 m, about 200 m² a
 * player (11v11 has about 320, futsal about 80), with markings scaled down to fit.
 */
export const SMALL_SIDED_PITCH: Pitch = {
  halfLength: 30,
  halfWidth: 20,
  penaltyAreaDepth: 10,
  penaltyAreaHalfWidth: 10,
  goalAreaDepth: 3,
  goalAreaHalfWidth: 5.5,
  penaltySpotDistance: 8,
  circleRadius: 6,
  freeKickDistance: 5,
}

/** A full-size pitch, 105 m by 68 m, with the standard markings. */
export const FULL_PITCH: Pitch = {
  halfLength: 52.5,
  halfWidth: 34,
  penaltyAreaDepth: 16.5,
  penaltyAreaHalfWidth: 20.16,
  goalAreaDepth: 5.5,
  goalAreaHalfWidth: 9.16,
  penaltySpotDistance: 11,
  circleRadius: 9.15,
  freeKickDistance: 9.15,
}

/** Sides with at least this many outfielders play on a full-size pitch unless a match asks otherwise. */
export const FULL_PITCH_FROM = 10

/** The pitch a match with `outfielders` a side plays on by default. */
export const pitchFor = (outfielders: number): Pitch => (outfielders >= FULL_PITCH_FROM ? FULL_PITCH : SMALL_SIDED_PITCH)

/**
 * Memoises `derive` per pitch, for values worked out from a pitch's size
 * (tuning distances, the threat map). The last pitch asked about is checked
 * first, as a match asks about the same one over and over.
 */
export function perPitch<T>(derive: (pitch: Pitch) => T): (pitch: Pitch) => T {
  const cache = new WeakMap<Pitch, T>()
  let lastPitch: Pitch | null = null
  let lastValue: T | undefined
  return (pitch) => {
    if (pitch === lastPitch) return lastValue as T
    let value = cache.get(pitch)
    if (value === undefined) {
      value = derive(pitch)
      cache.set(pitch, value)
    }
    lastPitch = pitch
    lastValue = value
    return value
  }
}

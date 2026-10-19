import type { MetricKey } from './actions'

export interface Band {
  lo: number
  hi: number
  note?: string
}

/**
 * Typical per-team values, counts per 90 minutes, in top European men's leagues (approximate, 2018–2024 public data such as FBref/Opta).
 * These are approximate ranges for a typical team, wide enough to cover most teams: a guide for realism, not a target to overfit.
 */
export const REFERENCE: Partial<Record<MetricKey, Band>> = {
  passes: { lo: 400, hi: 560 },
  passCompletion: { lo: 0.76, hi: 0.87 },
  passesOwnHalf: { lo: 0.38, hi: 0.52 },
  passesDefThird: { lo: 0.18, hi: 0.32 },
  passesMidThird: { lo: 0.4, hi: 0.52 },
  passesFinalThird: { lo: 0.2, hi: 0.32 },
  finalThirdEntries: { lo: 30, hi: 60 },
  boxEntries: { lo: 7, hi: 16 },
  forwardShare: { lo: 0.3, hi: 0.45 },
  backwardShare: { lo: 0.15, hi: 0.28 },
  progressive: { lo: 25, hi: 55 },
  avgPassLength: { lo: 16, hi: 21 },
  longShare: { lo: 0.08, hi: 0.16 },
  crosses: { lo: 10, hi: 22 },
  shots: { lo: 9, hi: 16 },
  goals: { lo: 1.0, hi: 1.8 },
  shotsInBox: { lo: 0.55, hi: 0.72 },
  avgShotDistance: { lo: 14, hi: 19 },
  onTarget: { lo: 0.3, hi: 0.4 },
  spells: { lo: 90, hi: 150 },
  passesPerSpell: { lo: 3, hi: 6 },
  spellsReachingFinalThird: { lo: 0.25, hi: 0.5 },
  ballInPlay: { lo: 0.55, hi: 0.65 },
  corners: { lo: 3.5, hi: 6.5 },
  throwIns: { lo: 17, hi: 27 },
  goalKicks: { lo: 5, hi: 10 },
}

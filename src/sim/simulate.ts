import { createMatch, stepMatch, type MatchOptions, type MatchStats } from './match'

/** Plays `attacks` attacks headlessly and returns the tally. */
export function simulateAttacks(attacks: number, options: MatchOptions): MatchStats {
  const match = createMatch({ seed: 1, ...options })
  const played = () => match.stats.shots + match.stats.lost + match.stats.setPieces
  while (played() < attacks || match.phase !== 'approach') stepMatch(match)
  return match.stats
}

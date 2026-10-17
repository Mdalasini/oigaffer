import { createMatch, stepMatch, type MatchStats } from './match'

/** Plays `shots` attacks headlessly and returns the tally. */
export function simulateShots(shots: number, shooting: number, reaction: number, seed = 1): MatchStats {
  const match = createMatch({ seed, shooting, reaction })
  while (match.stats.shots < shots || match.phase !== 'approach') stepMatch(match)
  return match.stats
}

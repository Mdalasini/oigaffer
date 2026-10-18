import { createMatch, stepMatch, type Grades, type MatchStats } from './match'

/** Plays `shots` attacks headlessly and returns the tally. */
export function simulateShots(shots: number, grades: Partial<Grades>, seed = 1): MatchStats {
  const match = createMatch({ seed, grades })
  while (match.stats.shots < shots || match.phase !== 'approach') stepMatch(match)
  return match.stats
}

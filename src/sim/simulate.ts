import { createMatch, stepMatch, type MatchOptions, type TeamStats } from './match'

/** Plays `minutes` of match time headlessly and returns each team's tally. */
export function simulateMatch(minutes: number, options: MatchOptions): [TeamStats, TeamStats] {
  const match = createMatch({ seed: 1, ...options })
  while (match.time < minutes * 60) stepMatch(match)
  return match.stats
}

import { createMatch, stepMatch, type MatchOptions, type TeamStats } from './match'

/** Plays `minutes` of match time headlessly, letting a shot in flight at the end finish, and returns each team's tally. */
export function simulateMatch(minutes: number, options: MatchOptions): [TeamStats, TeamStats] {
  const match = createMatch({ seed: 1, ...options })
  while (match.time < minutes * 60 || match.phase === 'shot') stepMatch(match)
  return match.stats
}

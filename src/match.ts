import type { Club, GameWorld } from "./model";
import { samplePoisson, type Rng } from "./random";
import { clubStrength } from "./strength";

// Goals a team scores against an equally matched opponent
const BASE_GOALS = 1.35;
// Keeps an empty or very weak defence from producing infinite xG
const MIN_STRENGTH = 1;

export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  homeXg: number;
  awayXg: number;
}

export function expectedGoals(attack: number, opponentDefence: number): number {
  return (BASE_GOALS * Math.max(attack, MIN_STRENGTH)) / Math.max(opponentDefence, MIN_STRENGTH);
}

export function simulateMatch(world: GameWorld, home: Club, away: Club, rng: Rng = Math.random): MatchResult {
  const h = clubStrength(world, home);
  const a = clubStrength(world, away);
  const homeXg = expectedGoals(h.attack, a.defence);
  const awayXg = expectedGoals(a.attack, h.defence);
  return {
    homeGoals: samplePoisson(homeXg, rng),
    awayGoals: samplePoisson(awayXg, rng),
    homeXg,
    awayXg,
  };
}

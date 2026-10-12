import { FATIGUE_EFFECT, FATIGUE_PER_METRE, FATIGUE_SPEED, FATIGUE_STAMINA } from "./constants";
import type { MatchPlayer } from "./state";

// Covering ground wears players down; fitter players tire more slowly
export function tire(p: MatchPlayer, metres: number): void {
  p.energy = Math.max(0, p.energy - metres * fatigueRate(p));
}

// Energy lost per metre for this player (constant over a match)
export function fatigueRate(p: MatchPlayer): number {
  return FATIGUE_PER_METRE * (1 - FATIGUE_STAMINA * (p.base.stamina - 10));
}

// Tired players do everything a little worse
export function refreshAttributes(p: MatchPlayer): void {
  const k = 1 - FATIGUE_EFFECT * (1 - p.energy);
  const { base, attributes } = p;
  attributes.passing = base.passing * k;
  attributes.shooting = base.shooting * k;
  attributes.dribbling = base.dribbling * k;
  attributes.tackling = base.tackling * k;
  attributes.goalkeeping = base.goalkeeping * k;
  attributes.stamina = base.stamina * k;
}

// ...and a little slower
export const speedFactor = (p: MatchPlayer): number => 1 - FATIGUE_SPEED * (1 - p.energy);

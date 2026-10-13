import { ACCEL_EFFECT, FATIGUE_EFFECT, FATIGUE_PER_METRE, FATIGUE_SPEED, FATIGUE_STAMINA, PACE_EFFECT } from "./constants";
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
  attributes.jumping = base.jumping * k;
  attributes.strength = base.strength * k;
  // speedFactor already slows tired players, so pace and acceleration stay at base
  attributes.pace = base.pace;
  attributes.acceleration = base.acceleration;
}

// ...and a little slower
export const speedFactor = (p: MatchPlayer): number => 1 - FATIGUE_SPEED * (1 - p.energy);

// Pace scales top speed, acceleration scales how quickly a player reaches it (base values, not fatigued)
export const paceFactor = (p: MatchPlayer): number => 1 + PACE_EFFECT * (p.base.pace - 10);
export const accelFactor = (p: MatchPlayer): number => 1 + ACCEL_EFFECT * (p.base.acceleration - 10);

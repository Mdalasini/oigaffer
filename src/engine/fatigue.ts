import type { Attributes } from "../model";
import { FATIGUE_EFFECT, FATIGUE_PER_METRE, FATIGUE_SPEED, FATIGUE_STAMINA } from "./constants";
import type { MatchPlayer } from "./state";

// Covering ground wears players down; fitter players tire more slowly
export function tire(p: MatchPlayer, metres: number): void {
  const rate = FATIGUE_PER_METRE * (1 - FATIGUE_STAMINA * (p.base.stamina - 10));
  p.energy = Math.max(0, p.energy - metres * rate);
}

// Tired players do everything a little worse
export function refreshAttributes(p: MatchPlayer): void {
  const k = 1 - FATIGUE_EFFECT * (1 - p.energy);
  for (const key of Object.keys(p.base) as (keyof Attributes)[]) p.attributes[key] = p.base[key] * k;
}

// ...and a little slower
export const speedFactor = (p: MatchPlayer): number => 1 - FATIGUE_SPEED * (1 - p.energy);

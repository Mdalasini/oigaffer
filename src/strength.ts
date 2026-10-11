import type { Club, GameWorld, Player, Position } from "./model";
import { pickEleven } from "./squad";

// How much each position contributes to each side of the game
const ATTACK_WEIGHT: Record<Position, number> = { GK: 0, DEF: 0.2, MID: 0.6, FWD: 1 };
const DEFENCE_WEIGHT: Record<Position, number> = { GK: 1, DEF: 1, MID: 0.6, FWD: 0.2 };

// Summary ratings derived from the detailed attributes
export function attackingRating(p: Player): number {
  const { passing, shooting, dribbling } = p.attributes;
  return (passing + shooting + dribbling) / 3;
}

export function defendingRating(p: Player): number {
  return p.position === "GK" ? p.attributes.goalkeeping : p.attributes.tackling;
}

export interface ClubStrength {
  attack: number;
  defence: number;
}

function weightedAverage(
  players: Player[],
  weights: Record<Position, number>,
  value: (p: Player) => number,
): number {
  let total = 0;
  let weightSum = 0;
  for (const p of players) {
    const w = weights[p.position];
    total += value(p) * w;
    weightSum += w;
  }
  return weightSum === 0 ? 0 : total / weightSum;
}

// Returns attack and defence of the club's best eleven, on the same 1–20 scale as player attributes
export function clubStrength(world: GameWorld, club: Club): ClubStrength {
  const players = pickEleven(world, club);
  return {
    attack: weightedAverage(players, ATTACK_WEIGHT, attackingRating),
    defence: weightedAverage(players, DEFENCE_WEIGHT, defendingRating),
  };
}

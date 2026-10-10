import type { Club, GameWorld, Player, Position } from "./model";

// How much each position contributes to each side of the game
const ATTACK_WEIGHT: Record<Position, number> = { GK: 0, DEF: 0.2, MID: 0.6, FWD: 1 };
const DEFENCE_WEIGHT: Record<Position, number> = { GK: 1, DEF: 1, MID: 0.6, FWD: 0.2 };

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

// Returns attack and defence on the same 1–20 scale as player attributes
export function clubStrength(world: GameWorld, club: Club): ClubStrength {
  const players = club.playerIds.map((id) => {
    const p = world.players[id];
    if (!p) throw new Error(`Club ${club.id} references unknown player ${id}`);
    return p;
  });
  return {
    attack: weightedAverage(players, ATTACK_WEIGHT, (p) => p.attributes.attacking),
    defence: weightedAverage(players, DEFENCE_WEIGHT, (p) => p.attributes.defending),
  };
}

import type { GameWorld, Player, Position } from "./model";

// Player whose derived attacking/defending ratings equal the given values
export const player = (id: string, position: Position, attacking: number, defending: number): Player => ({
  id,
  name: id,
  position,
  attributes: {
    passing: attacking,
    shooting: attacking,
    dribbling: attacking,
    tackling: defending,
    goalkeeping: defending,
    stamina: 12,
  },
});

export const FOUR_FOUR_TWO: Position[] = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD"];

export function squad(prefix: string, attacking: number, defending: number): Player[] {
  return FOUR_FOUR_TWO.map((pos, i) => player(`${prefix}${i}`, pos, attacking, defending));
}

// Two clubs, "strong" and "weak", each with a full eleven
export function strongVsWeak(strong = 16, weak = 8): GameWorld {
  const s = squad("s", strong, strong);
  const w = squad("w", weak, weak);
  return {
    players: Object.fromEntries([...s, ...w].map((p) => [p.id, p])),
    clubs: {
      strong: { id: "strong", name: "Strong FC", playerIds: s.map((p) => p.id) },
      weak: { id: "weak", name: "Weak FC", playerIds: w.map((p) => p.id) },
    },
  };
}

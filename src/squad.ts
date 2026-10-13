import type { Attributes, Club, GameWorld, Player, Position } from "./model";
import { lineCount, type FormationName } from "./tactics";

// How good someone is at playing in a line, whatever their natural position
export function lineRating(a: Attributes, line: Position): number {
  switch (line) {
    case "GK":
      return a.goalkeeping;
    case "DEF":
      return a.tackling;
    case "MID":
      return (a.passing + a.dribbling + a.tackling) / 3;
    case "FWD":
      return (a.shooting + a.dribbling) / 2;
  }
}

export function squadPlayers(world: GameWorld, club: Club): Player[] {
  return club.playerIds.map((id) => {
    const p = world.players[id];
    if (!p) throw new Error(`Club ${club.id} references unknown player ${id}`);
    return p;
  });
}

// The best eleven for a formation: each line is filled with the best natural
// players for it, then any gaps with whoever is best at that line among the rest.
export function pickEleven(world: GameWorld, club: Club, formation: FormationName = "4-4-2"): Player[] {
  const lines: Position[] = ["GK", "DEF", "MID", "FWD"];
  const need = Object.fromEntries(lines.map((line) => [line, lineCount(formation, line)])) as Record<Position, number>;
  const available = new Set(squadPlayers(world, club));
  const chosen: Player[] = [];

  const take = (line: Position, naturalOnly: boolean) => {
    const candidates = [...available]
      .filter((p) => !naturalOnly || p.position === line)
      .sort((a, b) => lineRating(b.attributes, line) - lineRating(a.attributes, line));
    for (const p of candidates) {
      if (need[line] === 0) return;
      available.delete(p);
      chosen.push(p);
      need[line]--;
    }
  };
  for (const line of lines) take(line, true);
  for (const line of lines) take(line, false);
  return chosen;
}

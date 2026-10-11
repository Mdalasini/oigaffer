import { doubleRoundRobin, type Round } from "./fixtures";
import { simulateMatch } from "./match";
import type { GameWorld } from "./model";
import type { Rng } from "./random";
import { buildTable, type Result, type TableRow } from "./table";

export interface Season {
  rounds: Round[];
  results: Result[];
  table: TableRow[];
}

export function playSeason(world: GameWorld, rng: Rng = Math.random): Season {
  const clubIds = Object.keys(world.clubs);
  const rounds = doubleRoundRobin(clubIds);
  const results: Result[] = [];

  for (const round of rounds) {
    for (const { homeId, awayId } of round) {
      const { homeGoals, awayGoals } = simulateMatch(world, world.clubs[homeId]!, world.clubs[awayId]!, rng);
      results.push({ homeId, awayId, homeGoals, awayGoals });
    }
  }

  return { rounds, results, table: buildTable(clubIds, results) };
}

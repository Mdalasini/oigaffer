import { simulateEventMatch } from "./engine/match";
import { simulateMatch } from "./match";
import { seededRng } from "./random";
import { playSeason } from "./season";
import { DEFAULT_CLUBS, generateWorld } from "./seed";
import { clubStrength } from "./strength";

// Usage: bun run season [seed] [--events]
const args = process.argv.slice(2);
const useEvents = args.includes("--events");
const seed = Number(args.find((a) => !a.startsWith("--")) ?? Date.now());
const rng = seededRng(seed);
const world = generateWorld(DEFAULT_CLUBS, rng);
const season = playSeason(world, rng, useEvents ? simulateEventMatch : simulateMatch);

console.log(`Seed ${seed}, ${useEvents ? "event" : "Poisson"} engine\n`);
console.log("Pos  Club                  P   W   D   L   GF  GA   GD  Pts   Att   Def");
season.table.forEach((row, i) => {
  const club = world.clubs[row.clubId]!;
  const { attack, defence } = clubStrength(world, club);
  const gd = row.goalDifference > 0 ? `+${row.goalDifference}` : `${row.goalDifference}`;
  console.log(
    [
      String(i + 1).padStart(3),
      " ",
      club.name.padEnd(20),
      ...[row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst].map((n) => String(n).padStart(3)),
      gd.padStart(4),
      String(row.points).padStart(4),
      attack.toFixed(1).padStart(5),
      defence.toFixed(1).padStart(5),
    ].join(" "),
  );
});

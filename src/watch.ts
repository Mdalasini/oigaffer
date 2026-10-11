// Plays one event-engine match and prints the key moments and stats.
// Usage: bun run watch [seed]
import { simulateEventMatch } from "./engine/match";
import { commentary, minuteLabel, type Names } from "./commentary";
import type { Side } from "./engine/state";
import { seededRng } from "./random";
import { DEFAULT_CLUBS, generateWorld } from "./seed";
import { teamStats, type TeamStats } from "./stats";

const seed = Number(process.argv[2] ?? Date.now());
const rng = seededRng(seed);
const world = generateWorld(DEFAULT_CLUBS, rng);
const [home, away] = Object.values(world.clubs);
const result = simulateEventMatch(world, home!, away!, rng);

const names: Names = {
  club: (side: Side) => (side === "home" ? home!.name : away!.name),
  player: (id: string) => world.players[id]?.name ?? id,
};

console.log(`Seed ${seed}\n`);
console.log(`${home!.name} ${result.homeGoals} - ${result.awayGoals} ${away!.name}\n`);
for (const line of commentary(result.events, names)) {
  console.log(`${minuteLabel(line.period, line.clock).padStart(6)}  ${line.text}`);
}

const stats = { home: teamStats(result.events, "home"), away: teamStats(result.events, "away") };
const rows: [string, (s: TeamStats) => string][] = [
  ["Goals", (s) => String(s.goals)],
  ["xG", (s) => s.xg.toFixed(2)],
  ["Shots", (s) => String(s.shots)],
  ["On target", (s) => String(s.onTarget)],
  ["Passes", (s) => String(s.passes)],
  ["Pass accuracy", (s) => `${Math.round(100 * s.passAccuracy)}%`],
  ["Tackles won", (s) => String(s.tacklesWon)],
  ["Interceptions", (s) => String(s.interceptions)],
  ["Clearances", (s) => String(s.clearances)],
  ["Through balls", (s) => String(s.throughBalls)],
  ["Crosses", (s) => String(s.crosses)],
  ["Corners", (s) => String(s.corners)],
  ["Fouls", (s) => String(s.fouls)],
  ["Offsides", (s) => String(s.offsides)],
  ["Yellow cards", (s) => String(s.yellows)],
  ["Red cards", (s) => String(s.reds)],
];

console.log(`\n${"".padEnd(16)}${home!.name.padStart(20)}${away!.name.padStart(20)}`);
for (const [label, value] of rows) console.log(`${label.padEnd(16)}${value(stats.home).padStart(20)}${value(stats.away).padStart(20)}`);

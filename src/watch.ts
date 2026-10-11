// Plays one event-engine match and prints the key moments and stats.
// Usage: bun run watch [seed]
import { simulateEventMatch } from "./engine/match";
import type { MatchEvent, Side } from "./engine/state";
import { seededRng } from "./random";
import { DEFAULT_CLUBS, generateWorld } from "./seed";
import { teamStats, type TeamStats } from "./stats";
import { MENTALITY_NAMES } from "./tactics";

const seed = Number(process.argv[2] ?? Date.now());
const rng = seededRng(seed);
const world = generateWorld(DEFAULT_CLUBS, rng);
const [home, away] = Object.values(world.clubs);
const result = simulateEventMatch(world, home!, away!, rng);

const clubName = (side: Side) => (side === "home" ? home!.name : away!.name);
const playerName = (id: string) => world.players[id]?.name ?? id;
const minute = (e: MatchEvent) => `${Math.floor((e.time - 1) / 60) + 1}'`.padStart(4);

console.log(`Seed ${seed}\n`);
console.log(`${home!.name} ${result.homeGoals} - ${result.awayGoals} ${away!.name}\n`);

for (const e of result.events) {
  if (e.type === "tactics") {
    const moves = e.moved.map((m) => `${playerName(m.playerId)} ${m.from}→${m.to}`).join(", ");
    const when = e.time === 0 ? "  KO" : minute(e);
    console.log(`${when}  ${clubName(e.side).padEnd(20)} ${e.formation}, ${MENTALITY_NAMES[e.mentality]}${moves && e.time > 0 ? `  (${moves})` : ""}`);
    continue;
  }
  if (e.type !== "shot") continue;
  const what = { goal: "GOAL", saved: "saved", off_target: "off target", blocked: "blocked" }[e.outcome];
  const line = `${minute(e)}  ${clubName(e.side).padEnd(20)} ${playerName(e.playerId).padEnd(18)} xG ${e.xg.toFixed(2)}  ${what}`;
  console.log(e.outcome === "goal" ? `${line}  ⚽` : line);
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
];

console.log(`\n${"".padEnd(16)}${home!.name.padStart(20)}${away!.name.padStart(20)}`);
for (const [label, value] of rows) console.log(`${label.padEnd(16)}${value(stats.home).padStart(20)}${value(stats.away).padStart(20)}`);

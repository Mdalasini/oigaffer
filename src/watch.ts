// Plays one event-engine match and prints the key moments and stats.
// Usage: bun run watch [seed]
import { simulateEventMatch } from "./engine/match";
import type { MatchEvent, Side } from "./engine/state";
import { seededRng } from "./random";
import { DEFAULT_CLUBS, generateWorld } from "./seed";
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

const stat = (side: Side, pred: (e: MatchEvent) => boolean) =>
  result.events.filter((e) => e.side === side && pred(e)).length;
const rows: [string, (s: Side) => string][] = [
  ["Goals", (s) => String(s === "home" ? result.homeGoals : result.awayGoals)],
  ["xG", (s) => (s === "home" ? result.homeXg : result.awayXg).toFixed(2)],
  ["Shots", (s) => String(stat(s, (e) => e.type === "shot"))],
  ["On target", (s) => String(stat(s, (e) => e.type === "shot" && (e.outcome === "goal" || e.outcome === "saved")))],
  ["Passes", (s) => String(stat(s, (e) => e.type === "pass"))],
  [
    "Pass accuracy",
    (s) => {
      const done = stat(s, (e) => e.type === "pass");
      const failed = result.events.filter(
        (e) => (e.type === "pass_astray" && e.side === s) || (e.type === "interception" && e.side !== s),
      ).length;
      return `${Math.round((100 * done) / Math.max(1, done + failed))}%`;
    },
  ],
  ["Tackles won", (s) => String(stat(s, (e) => e.type === "tackle" && e.won))],
  ["Interceptions", (s) => String(stat(s, (e) => e.type === "interception"))],
  ["Clearances", (s) => String(stat(s, (e) => e.type === "clearance"))],
  ["Through balls", (s) => String(stat(s, (e) => e.type === "through_ball"))],
];

console.log(`\n${"".padEnd(16)}${home!.name.padStart(20)}${away!.name.padStart(20)}`);
for (const [label, value] of rows) console.log(`${label.padEnd(16)}${value("home").padStart(20)}${value("away").padStart(20)}`);

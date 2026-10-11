// Plays many seasons with both engines on the same worlds and compares them.
// Usage: bun src/calibrate.ts [seasons]
import { simulateEventMatch } from "./engine/match";
import type { MatchEvent } from "./engine/state";
import { simulateMatch, type MatchEngine } from "./match";
import { seededRng } from "./random";
import { playSeason } from "./season";
import { generateWorld } from "./seed";
import { clubStrength } from "./strength";

const CLUBS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const seasons = Number(process.argv[2] ?? 5);

function summarise(name: string, engine: MatchEngine) {
  let matches = 0, goals = 0, homeWins = 0, draws = 0, favouriteWins = 0, favouriteLosses = 0;
  const strengthDiffs: number[] = [];
  const goalDiffs: number[] = [];
  const events: MatchEvent[] = [];

  const recordingEngine: MatchEngine = (world, home, away, rng) => {
    const result = engine(world, home, away, rng);
    if ("events" in result) events.push(...(result.events as MatchEvent[]));
    return result;
  };

  for (let s = 1; s <= seasons; s++) {
    const world = generateWorld(CLUBS, seededRng(s));
    const { results } = playSeason(world, seededRng(1000 + s), recordingEngine);
    for (const r of results) {
      const h = clubStrength(world, world.clubs[r.homeId]!);
      const a = clubStrength(world, world.clubs[r.awayId]!);
      const diff = h.attack + h.defence - a.attack - a.defence;
      matches++;
      goals += r.homeGoals + r.awayGoals;
      if (r.homeGoals > r.awayGoals) homeWins++;
      if (r.homeGoals === r.awayGoals) draws++;
      const fav = Math.sign(diff) * Math.sign(r.homeGoals - r.awayGoals);
      if (fav > 0) favouriteWins++;
      if (fav < 0) favouriteLosses++;
      strengthDiffs.push(diff);
      goalDiffs.push(r.homeGoals - r.awayGoals);
    }
  }

  const pct = (n: number) => `${((100 * n) / matches).toFixed(1)}%`;
  console.log(`\n${name} (${matches} matches)`);
  console.log(`  goals/game        ${(goals / matches).toFixed(2)}`);
  console.log(`  home W / D / A    ${pct(homeWins)} / ${pct(draws)} / ${pct(matches - homeWins - draws)}`);
  console.log(`  favourite W / L   ${pct(favouriteWins)} / ${pct(favouriteLosses)}`);
  console.log(`  strength→GD corr  ${correlation(strengthDiffs, goalDiffs).toFixed(2)}`);

  if (events.length > 0) {
    const count = (pred: (e: MatchEvent) => boolean) => events.filter(pred).length;
    const passes = count((e) => e.type === "pass");
    const failedPasses = count((e) => e.type === "interception" || e.type === "pass_astray");
    const shots = events.filter((e) => e.type === "shot");
    const per = (n: number) => (n / matches / 2).toFixed(1);
    console.log(`  per team per game:`);
    console.log(`    passes          ${per(passes)}  (${((100 * passes) / (passes + failedPasses)).toFixed(0)}% completed)`);
    console.log(`    shots           ${per(shots.length)}  (on target ${((100 * shots.filter((e) => e.type === "shot" && (e.outcome === "goal" || e.outcome === "saved")).length) / shots.length).toFixed(0)}%)`);
    console.log(`    xG              ${(shots.reduce((s, e) => s + (e.type === "shot" ? e.xg : 0), 0) / matches / 2).toFixed(2)}`);
    console.log(`    tackles won     ${per(count((e) => e.type === "tackle" && e.won))}`);
    console.log(`    through balls   ${per(count((e) => e.type === "through_ball"))}`);
    console.log(`    carries         ${per(count((e) => e.type === "dribble" && e.defenderId === null))}`);
    console.log(`    take-ons won    ${per(count((e) => e.type === "dribble" && e.defenderId !== null))}`);
    console.log(`    clearances      ${per(count((e) => e.type === "clearance"))}`);
    console.log(`    interceptions   ${per(count((e) => e.type === "interception"))}`);
    console.log(`    crosses         ${per(count((e) => e.type === "cross"))}  (won ${per(count((e) => e.type === "cross" && e.outcome === "won"))})`);
    console.log(`    corners         ${per(count((e) => e.type === "set_piece" && e.kind === "corner"))}`);
    console.log(`    throw-ins       ${per(count((e) => e.type === "set_piece" && e.kind === "throw_in"))}`);
    console.log(`    goal kicks      ${per(count((e) => e.type === "set_piece" && e.kind === "goal_kick"))}`);
    console.log(`    fouls           ${per(count((e) => e.type === "foul"))}  (advantage ${per(count((e) => e.type === "foul" && e.award === "advantage"))})`);
    console.log(`    offsides        ${per(count((e) => e.type === "offside"))}`);
    console.log(`    yellow / red    ${per(count((e) => e.type === "card" && e.card === "yellow"))} / ${per(count((e) => e.type === "card" && e.card !== "yellow"))}`);
    console.log(`    penalties       ${per(count((e) => e.type === "set_piece" && e.kind === "penalty"))}`);
    console.log(`    injuries        ${per(count((e) => e.type === "injury"))}`);
    console.log(`    subs            ${per(count((e) => e.type === "substitution"))}`);
    const goalsBy = (kind: string) =>
      count((e) => e.type === "shot" && e.outcome === "goal" && e.kind === kind);
    const allGoals = count((e) => e.type === "shot" && e.outcome === "goal");
    const share = (n: number) => `${((100 * n) / Math.max(1, allGoals)).toFixed(0)}%`;
    console.log(`  goals by type:     headers ${share(goalsBy("header"))}, free kicks ${share(goalsBy("free_kick"))}, penalties ${share(goalsBy("penalty"))}`);
    const added = events.filter((e) => e.type === "added_time");
    const avgAdded = (period: number) =>
      (added.filter((e) => e.period === period).reduce((s, e) => s + (e.type === "added_time" ? e.minutes : 0), 0) / matches).toFixed(1);
    console.log(`  added time:        ${avgAdded(1)} + ${avgAdded(2)} minutes`);
  }
}

function correlation(xs: number[], ys: number[]): number {
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    dx += (xs[i]! - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

summarise("Poisson", simulateMatch);
const start = performance.now();
summarise("Event", simulateEventMatch);
console.log(`\nEvent engine: ${((performance.now() - start) / (seasons * 90)).toFixed(1)} ms/match`);

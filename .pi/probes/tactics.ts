// usage: bun probe-tactics.ts <formation> <mentality> [matches]
import { simulateEventMatch } from "../src/engine/match";
import { fixedManager } from "../src/manager";
import { seededRng } from "../src/random";
import { strongVsWeak } from "../src/test-helpers";
import type { FormationName, Mentality } from "../src/tactics";
const [formation, mentality, n] = [process.argv[2] as FormationName, Number(process.argv[3]) as Mentality, Number(process.argv[4] ?? 160)];
const world = strongVsWeak(12, 12);
const test = fixedManager({ formation, mentality });
const base = fixedManager({ formation: "4-4-2", mentality: 0 });
const rng = seededRng(77);
let gf = 0, ga = 0, pts = 0;
for (let i = 0; i < n; i++) {
  const home = i % 2 === 0;
  const r = simulateEventMatch(world, world.clubs.strong!, world.clubs.weak!, rng, home ? { home: test, away: base } : { home: base, away: test });
  const f = home ? r.homeGoals : r.awayGoals, a = home ? r.awayGoals : r.homeGoals;
  gf += f; ga += a; pts += f > a ? 3 : f === a ? 1 : 0;
}
console.log(`${formation} ${mentality}: ${(gf / n).toFixed(2)}-${(ga / n).toFixed(2)}  ppg ${(pts / n).toFixed(2)}`);

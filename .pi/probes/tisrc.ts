const root = process.argv[2]!;
const { simulateEventMatch } = await import(root + "/src/engine/match");
const { generateWorld, DEFAULT_CLUBS } = await import(root + "/src/seed");
const { seededRng } = await import(root + "/src/random");
const rng = seededRng(3); const world = generateWorld(DEFAULT_CLUBS, rng); const clubs = Object.values(world.clubs) as any[];
const by: Record<string, number> = {}; let n = 0;
for (let i = 0; i < clubs.length; i++) for (let j = 0; j < clubs.length; j++) if (i !== j && n < 60) {
  n++; const r = simulateEventMatch(world, clubs[i], clubs[j], rng);
  const ev = r.events ?? []; 
  ev.forEach((e: any, k: number) => { if (e.type === "set_piece" && e.kind === "throw_in") { const p = ev.slice(0, k).reverse().find((q: any) => q.type !== "set_piece"); const key = p ? p.type + (p.outcome ? ":" + p.outcome : "") : "?"; by[key] = (by[key] ?? 0) + 1; } });
}
console.log(n, Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / n / 2).toFixed(2)}`).join(" | "));

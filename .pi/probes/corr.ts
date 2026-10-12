// Strength vs goal difference and xG difference over many seasons. Usage: bun corr.ts <srcRoot> <firstSeason> <seasons>
const [root, first, n] = [process.argv[2]!, Number(process.argv[3]), Number(process.argv[4])];
const { simulateEventMatch } = await import(root + "/engine/match");
const { seededRng } = await import(root + "/random");
const { playSeason } = await import(root + "/season");
const { generateWorld } = await import(root + "/seed");
const { clubStrength } = await import(root + "/strength");
const CLUBS = ["A","B","C","D","E","F","G","H","I","J"];
const sd: number[] = [], gd: number[] = [], xd: number[] = []; let fw = 0, fl = 0;
for (let s = first; s < first + n; s++) {
  const world = generateWorld(CLUBS, seededRng(s));
  const xgs = new Map<string, number>();
  const eng = (w: any, h: any, a: any, rng: any) => { const r = simulateEventMatch(w, h, a, rng); let x = 0; for (const e of r.events) if (e.type === "shot") x += e.side === "home" ? e.xg : -e.xg; xgs.set(h.id + a.id, x); return r; };
  const { results } = playSeason(world, seededRng(1000 + s), eng);
  for (const r of results) {
    const h = clubStrength(world, world.clubs[r.homeId]); const a = clubStrength(world, world.clubs[r.awayId]);
    const d = h.attack + h.defence - a.attack - a.defence; sd.push(d); gd.push(r.homeGoals - r.awayGoals); xd.push(xgs.get(r.homeId + r.awayId)!);
    const f = Math.sign(d) * Math.sign(r.homeGoals - r.awayGoals); if (f > 0) fw++; if (f < 0) fl++;
  }
}
const corr = (a: number[], b: number[]) => { const m = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length; const ma = m(a), mb = m(b); let c = 0, va = 0, vb = 0; for (let i = 0; i < a.length; i++) { c += (a[i]! - ma) * (b[i]! - mb); va += (a[i]! - ma) ** 2; vb += (b[i]! - mb) ** 2; } return c / Math.sqrt(va * vb); };
console.log(`${root.split("/").slice(-2)[0]} n=${sd.length} fav ${(100*fw/sd.length).toFixed(1)}/${(100*fl/sd.length).toFixed(1)} corrGD ${corr(sd, gd).toFixed(3)} corrXG ${corr(sd, xd).toFixed(3)}`);

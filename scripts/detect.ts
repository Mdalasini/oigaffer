// Plays headless matches and looks for behaviour that would look wrong to a
// watcher (see `src/sim/detectors.ts`): how often each kind happens, per 90
// minutes, and the cases themselves, each with the command to read it back.
//
//   bun scripts/detect.ts [minutes=30] [outfielders=4] [seeds=1,2,3] [options]
//
//   --only lostMan,dithering   only these detectors
//   --examples <n>             cases listed per detector per seed (default 3; 0 for rates only)
import { createMatch, stepMatch } from '../src/sim/match'
import { ticksAt } from '../src/sim/replay'
import { createDetectors, LOOK_EVERY, watchFor, type Finding } from '../src/sim/detectors'
import { clock, playerLabel } from '../src/sim/trace'

const args = process.argv.slice(2)
const option = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
const minutes = Number(positional[0] ?? 30)
const outfielders = Number(positional[1] ?? 4)
const seeds = (positional[2] ?? '1,2,3').split(',').map(Number)
const only = option('only')?.split(',')
const examples = Number(option('examples') ?? 3)
/** Seconds of lead-in and follow-through around a case when reading it back. */
const CONTEXT = 2

const per90 = (n: number) => (n * 90) / minutes
const totals = new Map<string, number>()
const pick = () => createDetectors().filter((d) => !only || only.includes(d.name))
for (const d of pick()) console.log(`${d.name}: ${d.about}${d.lasting ? `, for ${d.lasting} s or more` : ''}`)

for (const seed of seeds) {
  const world = createMatch({ seed, outfielders })
  const watch = watchFor(world, pick())
  const every = ticksAt(LOOK_EVERY)
  for (let tick = 1; world.time < minutes * 60; tick++) {
    stepMatch(world)
    if (tick % every === 0) watch.look()
  }
  watch.finish()
  const byKind = new Map<string, Finding[]>()
  for (const f of watch.findings) byKind.set(f.detector, [...(byKind.get(f.detector) ?? []), f])
  console.log(`\nseed ${seed}: ${watch.detectors.map((d) => `${d.name} ${per90(byKind.get(d.name)?.length ?? 0).toFixed(1)}/90`).join(', ')}`)
  for (const d of watch.detectors) totals.set(d.name, (totals.get(d.name) ?? 0) + per90(byKind.get(d.name)?.length ?? 0) / seeds.length)
  if (!examples) continue
  for (const [name, found] of byKind) {
    // The longest first: the clearest cases to look at.
    for (const f of [...found].sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, examples)) {
      const from = clock(Math.max(0, f.from - CONTEXT))
      const to = clock(f.to + CONTEXT)
      const players = f.players.map((eid) => playerLabel(world, eid)).join(',')
      console.log(`  ${name} ${clock(f.from)}–${clock(f.to)}: ${f.detail}`)
      console.log(`    bun run inspect --seed ${seed} --outfielders ${outfielders} --from ${from} --to ${to} --players ${players}`)
    }
  }
}
console.log(`\nmean: ${[...totals].map(([name, rate]) => `${name} ${rate.toFixed(1)}/90`).join(', ')}`)

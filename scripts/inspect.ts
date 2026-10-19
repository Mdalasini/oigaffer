// Replays a stretch of a match and writes it out as text.
//
//   bun scripts/inspect.ts <flag> [options]
//   bun scripts/inspect.ts --seed 1 --from 2:10 --to 2:20 [options]
//
// <flag> is the text the game copies when you flag a moment. Options:
//   --every <s>         seconds between snapshots of every player (default 0.5)
//   --players R3,B2,BK  only list these players in snapshots
//   --outfielders <n>   outfielders a side, with --seed (default 4)
//
// Cues (passes, turnovers, runs…) and events (tackles, shots, restarts) are
// listed as they happen, between snapshots.
import { OUTFIELDERS_PER_SIDE } from '../src/sim/constants'
import { decodeFlag, playBack, secondsAt, ticksAt, type Flag } from '../src/sim/replay'
import { clock, describeCue, describeEvent, describePlayers, describeSituation, parseClock, TRACE_LEGEND } from '../src/sim/trace'

const args = process.argv.slice(2)
const option = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}

const flag: Flag = args[0] && !args[0].startsWith('--')
  ? decodeFlag(args[0])
  : {
      seed: Number(option('seed') ?? NaN),
      outfielders: Number(option('outfielders') ?? OUTFIELDERS_PER_SIDE),
      inputs: [],
      from: ticksAt(parseClock(option('from') ?? '0')),
      to: ticksAt(parseClock(option('to') ?? '10')),
    }
if (!Number.isFinite(flag.seed)) {
  console.error('Give a flag, or --seed with --from and --to.')
  process.exit(1)
}
const every = ticksAt(Number(option('every') ?? 0.5))
const only = option('players') ? new Set(option('players')!.split(',').map((s) => s.trim().toUpperCase())) : undefined

console.log(`seed ${flag.seed}, ${flag.outfielders} outfielders a side, ${clock(secondsAt(flag.from))} to ${clock(secondsAt(flag.to))}`)
if (flag.note) console.log(`note: ${flag.note}`)
const earlier = flag.inputs.filter((i) => i.tick < flag.to)
if (earlier.length) console.log(`inputs: ${earlier.map((i) => `${clock(secondsAt(i.tick))} ${i.kind === 'grade' ? `${i.team} ${i.role} ${i.key} → ${i.grade}` : i.kind}`).join(', ')}`)
console.log(TRACE_LEGEND)

playBack(flag, (world, tick) => {
  if (tick === flag.from) {
    world.onCue = (c) => console.log(`    ${clock(world.time)}  cue: ${describeCue(world, c)}`)
    world.onEvent = (e) => console.log(`    ${clock(world.time)}  event: ${describeEvent(e)}`)
  }
  if (tick >= flag.from && ((tick - flag.from) % every === 0 || tick === flag.to)) {
    console.log(`\n${describeSituation(world)}`)
    for (const line of describePlayers(world, only)) console.log(line)
  }
  return tick < flag.to
})

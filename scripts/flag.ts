// Prints a flagged moment as text.
//
//   bun run flag                 latest flag
//   bun run flag <file>          a specific flag (path or name under flags/)
//   bun run flag --list          list flags
//   --at <s>                     state table and map at <s> seconds from the flag (default 0)
//   --from <s> --to <s>          trace window around the flag (default -6 .. 3)
//   --every <s>                  seconds between trace rows (default 0.5)
//   --trace H7,A4                trace extra players
//   --resim                      replay the window with the current code and report that instead

import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { FLAG_VERSION, resimulate, simAt, type Flag } from '../src/replay/flag'
import { clock, report } from '../src/replay/report'

const FLAGS_DIR = resolve(import.meta.dir, '../flags')

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    list: { type: 'boolean' },
    at: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    every: { type: 'string' },
    trace: { type: 'string' },
    resim: { type: 'boolean' },
  },
})

function flagFiles(): string[] {
  try {
    return readdirSync(FLAGS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
  } catch {
    return []
  }
}

if (values.list) {
  for (const f of flagFiles()) {
    const flag: Flag = await Bun.file(join(FLAGS_DIR, f)).json()
    console.log(`${f}  ${clock(flag.flagTick)}  ${flag.subjects.join(',') || '-'}  ${flag.note}`)
  }
  process.exit(0)
}

const arg = positionals[0]
const files = flagFiles()
const path = arg ? (arg.includes('/') ? resolve(arg) : join(FLAGS_DIR, arg.endsWith('.json') ? arg : `${arg}.json`)) : files.length ? join(FLAGS_DIR, files[files.length - 1]) : ''
if (!path) {
  console.error(`No flags in ${FLAGS_DIR}`)
  process.exit(1)
}

const flag: Flag = await Bun.file(path).json()
const num = (v: string | undefined) => (v === undefined ? undefined : Number(v))
const opts = {
  at: num(values.at),
  from: num(values.from),
  to: num(values.to),
  every: num(values.every),
  trace: values.trace?.split(',').filter(Boolean),
  simAtFlag: undefined as ReturnType<typeof simAt> | undefined,
}

console.log(`File: ${path}`)
let replayable = flag.version === FLAG_VERSION
if (replayable) {
  try {
    opts.simAtFlag = simAt(flag, flag.flagTick)
  } catch (err) {
    replayable = false
    console.log(`Cannot re-simulate (${(err as Error).message}); showing the recording only.`)
  }
} else {
  console.log(`Flag version ${flag.version} predates the current sim (version ${FLAG_VERSION}); showing the recording only.`)
}
if (values.resim && replayable) {
  const r = resimulate(flag)
  console.log(
    r.firstDriftTick < 0
      ? `Re-simulated with current code: matches the recording (max drift ${r.maxDrift.toFixed(3)} m).`
      : `Re-simulated with current code: diverges from the recording at ${clock(r.firstDriftTick)} (max drift ${r.maxDrift.toFixed(2)} m). Report below is the re-simulation.`,
  )
  console.log(report(flag, { ...opts, data: r.data, events: r.events }))
} else {
  console.log(report(flag, opts))
}

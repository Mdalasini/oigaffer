// Plays headless matches and sets what players did against real-football bands.
//
//   bun scripts/realism.ts [minutes=90] [seeds=1,2,3,4] [--json]
//
// Each metric is the mean over both teams and every seed, so it's a typical
// team, with the range of the per-team, per-seed values alongside. The bands
// are a guide for realism, not a target. Counts are per 90 minutes of a real
// match, scaled by how long the ball was in play (see `REAL_MINUTES_IN_PLAY`). With --json, prints one object with
// the same numbers instead of the table.
import { METRIC_KEYS, SHARE_KEYS, recordActions, summarise, type MetricKey } from '../src/sim/actions'
import { OUTFIELDERS_PER_SIDE } from '../src/sim/constants'
import { createMatch, stepMatch } from '../src/sim/match'
import { REFERENCE } from '../src/sim/reference'

const args = process.argv.slice(2)
const json = args.includes('--json')
const [minutesArg = '90', seedsArg = '1,2,3,4'] = args.filter((a) => a !== '--json')
const minutes = Number(minutesArg)
const seeds = seedsArg.split(',').map(Number)

/** Metres, goals and passes per spell read better with a decimal place. */
const ONE_DECIMAL: readonly MetricKey[] = ['avgPassLength', 'avgShotDistance', 'goals', 'passesPerSpell']
const isShare = (key: MetricKey) => SHARE_KEYS.includes(key)
const format = (key: MetricKey, v: number) => (isShare(key) ? `${(100 * v).toFixed(0)}%` : v.toFixed(ONE_DECIMAL.includes(key) ? 1 : 0))
/** A band's edge keeps its own decimals, so 3.5 doesn't read as 4. */
const formatEdge = (key: MetricKey, v: number) => (Number.isInteger(v) || isShare(key) || ONE_DECIMAL.includes(key) ? format(key, v) : v.toFixed(1))

const samples = Object.fromEntries(METRIC_KEYS.map((key) => [key, [] as number[]])) as Record<MetricKey, number[]>
let formations = ''
for (const [i, seed] of seeds.entries()) {
  const world = createMatch({ seed, outfielders: OUTFIELDERS_PER_SIDE })
  if (i === 0) formations = `${world.teams[0].formation} v ${world.teams[1].formation}`
  const rec = recordActions(world)
  while (world.time < minutes * 60) {
    stepMatch(world)
    rec.afterStep()
  }
  const [red, blue] = summarise(rec.finish())
  for (const key of METRIC_KEYS) samples[key].push(red[key], blue[key])
}

const rows = METRIC_KEYS.map((key) => {
  const values = samples[key]
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const band = REFERENCE[key]
  const status = band ? (mean < band.lo ? 'LOW' : mean > band.hi ? 'HIGH' : 'ok') : null
  return { key, mean, min: Math.min(...values), max: Math.max(...values), lo: band?.lo, hi: band?.hi, status }
})

if (json) {
  const metrics = Object.fromEntries(rows.map(({ key, mean, min, max, lo, hi, status }) => [key, { mean, min, max, lo, hi, status }]))
  console.log(JSON.stringify({ metrics }, null, 2))
} else {
  console.log(`${minutes} minutes, seeds ${seeds.join(',')}, ${OUTFIELDERS_PER_SIDE} outfielders a side: ${formations}`)
  const width = Math.max(...METRIC_KEYS.map((k) => k.length))
  for (const r of rows) {
    const real = REFERENCE[r.key] ? `real ${formatEdge(r.key, r.lo ?? 0)}–${formatEdge(r.key, r.hi ?? 0)}` : ''
    console.log(`${r.key.padEnd(width)}  ${format(r.key, r.mean).padStart(6)}  [${format(r.key, r.min)}–${format(r.key, r.max)}]  ${real.padEnd(20)}  ${r.status ?? ''}`.trimEnd())
  }
  const banded = rows.filter((r) => r.status !== null)
  console.log(`${banded.filter((r) => r.status === 'ok').length} of ${banded.length} metrics inside the real band`)
}

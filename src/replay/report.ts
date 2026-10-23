// Text rendering of a flag: what happened, where everyone was and what they
// were trying to do, in a form that can be read without watching the match.

import { TICK_RATE } from '../sim/constants'
import type { SimEvent } from '../sim/events'
import { INTENT_NAMES, type IntentKind } from '../sim/intents'
import { HALF_LENGTH, HALF_WIDTH } from '../sim/pitch'
import { Phase, Restart } from '../sim/state'
import type { Flag } from './flag'
import { age, believe } from '../sim/perception'
import type { Sim } from '../sim/sim'
import { ENTITY_FIELDS, FRAME_FIELDS } from './recorder'

const PHASES = Object.fromEntries(Object.entries(Phase).map(([k, v]) => [v, k]))
const RESTARTS = Object.fromEntries(Object.entries(Restart).map(([k, v]) => [v, k]))

export interface ReportOptions {
  /** Seconds relative to the flagged tick for the state table and map. */
  at?: number
  /** Extra players to trace besides the flag's subjects. */
  trace?: string[]
  /** Trace window, seconds relative to the flagged tick. */
  from?: number
  to?: number
  /** Seconds between trace rows. */
  every?: number
  /** Frames to report instead of the recorded ones (from a re-simulation). */
  data?: number[]
  events?: SimEvent[]
  /** The sim at the flagged tick, for the subjects' beliefs (see flag.simAt). */
  simAtFlag?: Sim
}

export function clock(tick: number): string {
  const s = tick / TICK_RATE
  const min = Math.floor(s / 60)
  return `${String(min).padStart(2, '0')}:${(s - min * 60).toFixed(1).padStart(4, '0')}`
}

const fx = (v: number, w = 6) => v.toFixed(1).padStart(w)

export class FrameReader {
  constructor(
    readonly flag: Flag,
    readonly data: number[] = flag.frames.data,
  ) {}

  get firstTick() {
    return this.flag.frames.firstTick
  }

  get lastTick() {
    return this.flag.frames.firstTick + this.flag.frames.count - 1
  }

  has(tick: number) {
    return tick >= this.firstTick && tick <= this.lastTick && (tick - this.firstTick) * this.flag.frames.stride < this.data.length
  }

  header(tick: number, field: (typeof FRAME_FIELDS)[number]) {
    return this.data[(tick - this.firstTick) * this.flag.frames.stride + FRAME_FIELDS.indexOf(field)]
  }

  get(tick: number, index: number, field: (typeof ENTITY_FIELDS)[number]) {
    const base = (tick - this.firstTick) * this.flag.frames.stride + FRAME_FIELDS.length
    return this.data[base + index * ENTITY_FIELDS.length + ENTITY_FIELDS.indexOf(field)]
  }
}

export function describeEvent(flag: Flag, e: SimEvent): string {
  const name = (eid: number) => (eid < 0 ? '-' : (flag.labels[flag.entities.indexOf(eid)] ?? `#${eid}`))
  const at = (x: number, y: number) => `(${x.toFixed(1)}, ${y.toFixed(1)})`
  switch (e.type) {
    case 'kick':
      return `kick ${e.kind}${e.pass ? ` (${e.pass}${e.firstTime ? ', first time' : ''})` : e.firstTime ? ' (first time)' : ''} ${name(e.by)}${e.to >= 0 ? ` -> ${name(e.to)}` : ''} at ${at(e.x, e.y)}`
    case 'control':
      return `control ${name(e.by)} at ${at(e.x, e.y)}`
    case 'out':
      return `out: ${RESTARTS[e.restart]} to ${e.team === 0 ? 'Home' : 'Away'} at ${at(e.x, e.y)}, last touch ${name(e.lastTouch)}`
    case 'goal':
      return `GOAL ${e.team === 0 ? 'Home' : 'Away'}, scorer ${name(e.scorer)}`
    case 'phase':
      return `phase -> ${PHASES[e.phase]}`
    case 'call':
      return `call "${e.call}" ${name(e.by)} -> ${name(e.to)} about ${name(e.about)}`
    case 'woodwork':
      return `off the ${e.z > 2.3 ? 'bar' : 'post'} at ${at(e.x, e.y)}`
    case 'save':
      return `save (${e.kind}) by ${name(e.by)}, ball at ${e.speed.toFixed(0)} m/s`
  }
}

export function report(flag: Flag, opts: ReportOptions = {}): string {
  const r = new FrameReader(flag, opts.data)
  const events = opts.events ?? flag.events
  const at = clampTick(r, flag.flagTick + Math.round((opts.at ?? 0) * TICK_RATE))
  const out: string[] = []
  const homeDir = r.header(at, 'half') === 1 ? '+x (left to right)' : '-x (right to left)'
  out.push(`FLAG  ${flag.createdAt}`)
  out.push(`Note: ${flag.note || '(none)'}`)
  out.push(`Subjects: ${flag.subjects.join(', ') || '(none)'}`)
  out.push(`Flagged at ${clock(flag.flagTick)} (tick ${flag.flagTick}), seed ${flag.config.seed}`)
  out.push(`At the reported moment Home ${flag.config.formations[0]} attacks ${homeDir}; Away ${flag.config.formations[1]} the other way.`)
  if (r.header(r.firstTick, 'half') !== r.header(r.lastTick, 'half')) out.push('The window spans half time: the teams swap ends at the second-half kick-off.')
  out.push(`Pitch x in [-${HALF_LENGTH}, ${HALF_LENGTH}], y in [-${HALF_WIDTH}, ${HALF_WIDTH}] metres; headings in degrees, 0 = +x, 90 = +y.`)
  out.push(`Window ${clock(r.firstTick)} - ${clock(r.lastTick)}`)
  out.push('')
  out.push('EVENTS (time relative to flag)')
  for (const e of events) {
    if (e.type === 'control' && !nearFlag(flag, e.tick, 6)) continue
    out.push(`  ${rel(flag, e.tick)}  ${describeEvent(flag, e)}`)
  }
  out.push('')
  out.push(...stateTable(flag, r, at))
  out.push('')
  out.push(...asciiMap(flag, r, at))
  const traced = [...new Set([...flag.subjects, ...(opts.trace ?? [])])]
  for (const who of traced) {
    out.push('')
    out.push(...trace(flag, r, who, opts.from ?? -6, opts.to ?? 3, opts.every ?? 0.5))
    if (opts.simAtFlag) {
      out.push('')
      out.push(...beliefs(flag, opts.simAtFlag, who))
    }
  }
  return out.join('\n')
}

function nearFlag(flag: Flag, tick: number, seconds: number) {
  return Math.abs(tick - flag.flagTick) <= seconds * TICK_RATE
}

function rel(flag: Flag, tick: number): string {
  const s = (tick - flag.flagTick) / TICK_RATE
  return `${s >= 0 ? '+' : '-'}${Math.abs(s).toFixed(1).padStart(4)}s`
}

function clampTick(r: FrameReader, tick: number) {
  return Math.max(r.firstTick, Math.min(r.lastTick, tick))
}

function intentName(kind: number) {
  return kind < 0 ? '-' : (INTENT_NAMES[kind as IntentKind] ?? String(kind))
}

function stateTable(flag: Flag, r: FrameReader, tick: number): string[] {
  const out: string[] = []
  const owner = r.header(tick, 'owner')
  const name = (eid: number) => (eid < 0 ? '-' : flag.labels[flag.entities.indexOf(eid)])
  const bx = r.get(tick, 0, 'x')
  const by = r.get(tick, 0, 'y')
  const bvx = r.get(tick, 0, 'vx')
  const bvy = r.get(tick, 0, 'vy')
  out.push(`STATE at ${rel(flag, tick)} (${clock(tick)}), phase ${PHASES[r.header(tick, 'phase')]}, possession ${['Home', 'Away'][r.header(tick, 'possession')] ?? '-'}`)
  out.push(
    `  ball (${fx(bx)},${fx(by)}) z ${r.get(tick, 0, 'z').toFixed(2)}  vel (${fx(bvx, 5)},${fx(bvy, 5)}) ${Math.hypot(bvx, bvy).toFixed(1)} m/s  owner ${name(owner)}`,
  )
  out.push('  who  role  pos             speed  head  intent       target  d-ball')
  for (let i = 1; i < flag.entities.length; i++) {
    const x = r.get(tick, i, 'x')
    const y = r.get(tick, i, 'y')
    const speed = Math.hypot(r.get(tick, i, 'vx'), r.get(tick, i, 'vy'))
    const head = Math.round((r.get(tick, i, 'facing') * 180) / Math.PI)
    const target = r.get(tick, i, 'target')
    const mark = flag.subjects.includes(flag.labels[i]) ? '*' : ' '
    out.push(
      ` ${mark}${flag.labels[i].padEnd(4)} ${flag.roles[i].padEnd(4)} (${fx(x)},${fx(y)})  ${speed.toFixed(1).padStart(5)}  ${String(head).padStart(4)}  ${intentName(r.get(tick, i, 'intent')).padEnd(12)} ${name(target).padEnd(6)}  ${Math.hypot(x - bx, y - by).toFixed(1).padStart(5)}`,
    )
  }
  return out
}

const COLS = 70
const ROWS = 23

function asciiMap(flag: Flag, r: FrameReader, tick: number): string[] {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(' '))
  const toCol = (x: number) => Math.round(((x + HALF_LENGTH) / (2 * HALF_LENGTH)) * (COLS - 1))
  const toRow = (y: number) => Math.round(((HALF_WIDTH - y) / (2 * HALF_WIDTH)) * (ROWS - 1))
  for (let row = 0; row < ROWS; row++) {
    grid[row][0] = '|'
    grid[row][COLS - 1] = '|'
    grid[row][toCol(0)] = ':'
  }
  for (const gy of [-3.66, 0, 3.66]) {
    grid[toRow(gy)][0] = '#'
    grid[toRow(gy)][COLS - 1] = '#'
  }
  const put = (x: number, y: number, text: string) => {
    const row = Math.max(0, Math.min(ROWS - 1, toRow(y)))
    let col = Math.max(0, Math.min(COLS - text.length, toCol(x) - Math.floor(text.length / 2)))
    for (const ch of text) {
      const cur = grid[row][col]
      grid[row][col++] = cur !== ' ' && cur !== ':' && cur !== '|' ? '+' : ch
    }
  }
  for (let i = 1; i < flag.entities.length; i++) put(r.get(tick, i, 'x'), r.get(tick, i, 'y'), flag.labels[i])
  put(r.get(tick, 0, 'x'), r.get(tick, 0, 'y'), 'o')
  const cellX = ((2 * HALF_LENGTH) / (COLS - 1)).toFixed(1)
  const cellY = ((2 * HALF_WIDTH) / (ROWS - 1)).toFixed(1)
  return [
    `MAP at ${rel(flag, tick)} (o = ball, + = overlap, +y up, cell ${cellX} x ${cellY} m)`,
    ' ' + '-'.repeat(COLS),
    ...grid.map((row) => ' ' + row.join('')),
    ' ' + '-'.repeat(COLS),
  ]
}

function trace(flag: Flag, r: FrameReader, who: string, from: number, to: number, every: number): string[] {
  const i = flag.labels.indexOf(who)
  if (i < 0) return [`TRACE ${who}: no such player`]
  const name = (eid: number) => (eid < 0 ? '-' : flag.labels[flag.entities.indexOf(eid)])
  const out = [`TRACE ${who} (${flag.roles[i]})`, '  t       pos             speed  head  intent       target  d-ball  ball-owner']
  const step = Math.max(1, Math.round(every * TICK_RATE))
  for (let t = flag.flagTick + Math.round(from * TICK_RATE); t <= flag.flagTick + to * TICK_RATE; t += step) {
    if (!r.has(t)) continue
    const x = r.get(t, i, 'x')
    const y = r.get(t, i, 'y')
    const speed = Math.hypot(r.get(t, i, 'vx'), r.get(t, i, 'vy'))
    const head = Math.round((r.get(t, i, 'facing') * 180) / Math.PI)
    const d = Math.hypot(x - r.get(t, 0, 'x'), y - r.get(t, 0, 'y'))
    out.push(
      `  ${rel(flag, t)}  (${fx(x)},${fx(y)})  ${speed.toFixed(1).padStart(5)}  ${String(head).padStart(4)}  ${intentName(r.get(t, i, 'intent')).padEnd(12)} ${name(r.get(t, i, 'target')).padEnd(6)}  ${d.toFixed(1).padStart(5)}   ${name(r.header(t, 'owner'))}`,
    )
  }
  return out
}

/** Where a player thinks everyone is, for entries that are stale or off by more than a metre. */
function beliefs(flag: Flag, sim: Sim, who: string): string[] {
  const i = flag.labels.indexOf(who)
  if (i < 0) return []
  const observer = flag.entities[i]
  const out = [
    `BELIEFS of ${who} at +0.0s, re-simulated (stale > 0.3 s or off > 1 m; the ball always shown)`,
    '  who   believed        actual           off   age',
  ]
  const b = { x: 0, y: 0, vx: 0, vy: 0 }
  for (let k = 0; k < flag.entities.length; k++) {
    const target = flag.entities[k]
    if (target === observer) continue
    believe(sim, observer, target, b)
    const ax = sim.c.Pos.x[target]
    const ay = sim.c.Pos.y[target]
    const off = Math.hypot(b.x - ax, b.y - ay)
    const seconds = age(sim, observer, target)
    if (k !== 0 && seconds <= 0.3 && off <= 1) continue
    out.push(`  ${flag.labels[k].padEnd(5)} (${fx(b.x)},${fx(b.y)})  (${fx(ax)},${fx(ay)})  ${off.toFixed(1).padStart(5)}  ${seconds.toFixed(1)}s`)
  }
  if (out.length === 3) out.push('  (everyone else seen within 0.3 s and placed within 1 m)')
  return out
}

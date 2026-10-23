// A flag captures a moment the user thinks is wrong: their note, the players
// they picked, the recorded frames around the moment and a snapshot to
// re-simulate it from. Flags are JSON files under flags/.

import { TICK_RATE } from '../sim/constants'
import type { SimEvent } from '../sim/events'
import { createSim, label, roleOf, type Sim } from '../sim/sim'
import { restore } from '../sim/snapshot'
import type { MatchConfig } from '../sim/state'
import { step } from '../sim/step'
import { ENTITY_FIELDS, FRAME_FIELDS, Recorder, type Keyframe } from './recorder'

export const FLAG_VERSION = 1
const BEFORE = 20 * TICK_RATE
const AFTER = 5 * TICK_RATE

export interface Flag {
  version: number
  createdAt: string
  note: string
  /** Labels of the players the user picked, e.g. ["H7"]. */
  subjects: string[]
  config: MatchConfig
  flagTick: number
  /** Entity ids in frame order, with their labels and roles. */
  entities: number[]
  labels: string[]
  roles: string[]
  keyframe: Keyframe
  frames: { firstTick: number; stride: number; count: number; data: number[] }
  events: SimEvent[]
}

export function createFlag(sim: Sim, rec: Recorder, flagTick: number, note: string, subjects: number[]): Flag {
  const first = Math.max(rec.firstTick(), flagTick - BEFORE)
  const last = Math.min(rec.lastTick(), flagTick + AFTER)
  const keyframe = rec.keyframeAtOrBefore(first)
  if (!keyframe) throw new Error('no keyframe covers the flagged window')
  const data: number[] = []
  const events: SimEvent[] = []
  for (let t = first; t <= last; t++) {
    for (const v of rec.frame(t)) data.push(round(v))
    events.push(...rec.eventsAt(t))
  }
  return {
    version: FLAG_VERSION,
    createdAt: new Date().toISOString(),
    note,
    subjects: subjects.map((e) => label(sim, e)),
    config: sim.cfg,
    flagTick,
    entities: rec.entities,
    labels: rec.entities.map((e) => label(sim, e)),
    roles: rec.entities.map((e) => (e === sim.ball ? 'ball' : roleOf(sim, e))),
    keyframe,
    frames: { firstTick: first, stride: rec.stride, count: last - first + 1, data },
    events,
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** The sim as it was at `tick`, rebuilt from the flag's keyframe with the current code. */
export function simAt(flag: Flag, tick: number): Sim {
  const sim = createSim(flag.config)
  restore(sim, flag.keyframe.snap)
  while (sim.m.tick < tick) step(sim)
  return sim
}

export interface Resim {
  sim: Sim
  /** Frames from the current code, laid out like Flag.frames.data. */
  data: number[]
  events: SimEvent[]
  /** Largest 3D position difference (m) from the recorded frames, and the first tick it exceeded 1 cm. */
  maxDrift: number
  firstDriftTick: number
}

/** Replays the flagged window with the current code, starting from the flag's keyframe. */
export function resimulate(flag: Flag): Resim {
  const sim = createSim(flag.config)
  restore(sim, flag.keyframe.snap)
  const rec = new Recorder(sim)
  const { firstTick, count, stride } = flag.frames
  const lastTick = firstTick + count - 1
  const data: number[] = []
  const events: SimEvent[] = []
  let maxDrift = 0
  let firstDriftTick = -1
  // The keyframe may itself be the window's first tick, so record before stepping.
  for (;;) {
    if (sim.m.tick >= firstTick) record()
    if (sim.m.tick >= lastTick) break
    const before = sim.m.tick
    step(sim)
    if (sim.m.tick === before) break
  }
  return { sim, data, events, maxDrift, firstDriftTick }

  function record() {
    rec.afterTick(sim)
    const frame = rec.frame(sim.m.tick)
    const base = (sim.m.tick - firstTick) * stride
    for (let i = 0; i < stride; i++) data.push(round(frame[i]))
    events.push(...sim.m.events)
    for (let e = 0; e < flag.entities.length; e++) {
      const o = FRAME_FIELDS.length + e * ENTITY_FIELDS.length
      const dx = frame[o] - flag.frames.data[base + o]
      const dy = frame[o + 1] - flag.frames.data[base + o + 1]
      const dz = frame[o + 2] - flag.frames.data[base + o + 2]
      const drift = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (drift > maxDrift) maxDrift = drift
      if (drift > 0.01 && firstDriftTick < 0) firstDriftTick = sim.m.tick
    }
  }
}

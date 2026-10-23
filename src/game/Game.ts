// Runs the sim at its fixed tick rate behind the render loop, records the
// last stretch of play, and lets the viewer pause, scrub back and flag.

import { createFlag, type Flag } from '../replay/flag'
import { Recorder } from '../replay/recorder'
import { MAX_ENTITIES } from '../sim/components'
import { DT } from '../sim/constants'
import { newMatch } from '../sim/match'
import { createSim, DEFAULT_CONFIG, type Sim } from '../sim/sim'
import { restore } from '../sim/snapshot'
import type { MatchConfig } from '../sim/state'
import { step } from '../sim/step'

/** Never run more than this many ticks per frame; a slow frame drops time rather than spiralling. */
const MAX_TICKS_PER_FRAME = 40

export class Game {
  sim: Sim
  rec: Recorder
  speed = 1
  paused = false
  /** Recorded tick being shown while scrubbing, or null for the live match. */
  scrubTick: number | null = null
  selected: number[] = []
  private acc = 0
  /** x, y, z of every entity at the previous tick. */
  readonly prev = new Float64Array(MAX_ENTITIES * 3)
  private listeners = new Set<() => void>()

  constructor(cfg: MatchConfig = DEFAULT_CONFIG) {
    this.sim = newMatch(cfg)
    this.rec = new Recorder(this.sim)
    this.savePrev()
  }

  /** Advances by real elapsed seconds; returns the interpolation factor between the last two ticks. */
  advance(realSeconds: number): number {
    if (this.paused) return 1
    this.acc += Math.min(realSeconds, 0.25) * this.speed
    let ticks = 0
    while (this.acc >= DT && ticks < MAX_TICKS_PER_FRAME) {
      this.tick()
      this.acc -= DT
      ticks++
    }
    if (ticks === MAX_TICKS_PER_FRAME) this.acc = 0
    if (ticks > 0) this.notify()
    return this.acc / DT
  }

  tick(): void {
    this.rec.beforeTick(this.sim)
    this.savePrev()
    step(this.sim)
    this.rec.afterTick(this.sim)
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (!paused) this.scrubTick = null
    this.notify()
  }

  setSpeed(speed: number): void {
    this.speed = speed
    this.notify()
  }

  /** Shows a recorded tick (pausing the match), clamped to what is recorded. */
  scrubTo(tick: number): void {
    if (this.rec.length === 0) return
    this.paused = true
    this.scrubTick = Math.max(this.rec.firstTick(), Math.min(this.rec.lastTick(), tick))
    this.notify()
  }

  /** The tick on screen: the scrubbed one, or the latest. */
  shownTick(): number {
    return this.scrubTick ?? this.sim.m.tick
  }

  toggleSelected(eid: number, additive: boolean): void {
    const has = this.selected.includes(eid)
    if (additive) this.selected = has ? this.selected.filter((e) => e !== eid) : [...this.selected, eid]
    else this.selected = has && this.selected.length === 1 ? [] : [eid]
    this.notify()
  }

  flag(note: string): Flag {
    return createFlag(this.sim, this.rec, this.shownTick(), note, this.selected)
  }

  /** Re-simulates a saved flag's window and shows its flagged tick. */
  loadFlag(flag: Flag): void {
    const sim = createSim(flag.config)
    restore(sim, flag.keyframe.snap)
    this.sim = sim
    this.rec = new Recorder(sim)
    const last = flag.frames.firstTick + flag.frames.count - 1
    while (sim.m.tick < last) this.tick()
    this.savePrev()
    this.selected = flag.subjects.map((l) => flag.entities[flag.labels.indexOf(l)]).filter((e) => e !== undefined)
    this.scrubTo(flag.flagTick)
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify() {
    for (const fn of this.listeners) fn()
  }

  private savePrev() {
    const { Pos, Air } = this.sim.c
    for (let e = 0; e < MAX_ENTITIES; e++) {
      this.prev[e * 3] = Pos.x[e]
      this.prev[e * 3 + 1] = Pos.y[e]
      this.prev[e * 3 + 2] = Air.z[e]
    }
  }
}

// Runs the sim at its fixed tick rate behind the render loop and keeps the
// previous tick's positions so frames can interpolate between ticks.

import { MAX_ENTITIES } from '../sim/components'
import { DT } from '../sim/constants'
import { newMatch } from '../sim/match'
import { DEFAULT_CONFIG, type Sim } from '../sim/sim'
import type { MatchConfig } from '../sim/state'
import { step } from '../sim/step'

/** Never run more than this many ticks per frame; a slow frame drops time rather than spiralling. */
const MAX_TICKS_PER_FRAME = 40

export class Game {
  sim: Sim
  speed = 1
  paused = false
  private acc = 0
  /** x, y, z of every entity at the previous tick. */
  readonly prev = new Float64Array(MAX_ENTITIES * 3)
  private listeners = new Set<() => void>()

  constructor(cfg: MatchConfig = DEFAULT_CONFIG) {
    this.sim = newMatch(cfg)
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
    this.savePrev()
    step(this.sim)
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    this.notify()
  }

  setSpeed(speed: number): void {
    this.speed = speed
    this.notify()
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

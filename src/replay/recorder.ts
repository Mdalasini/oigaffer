// Rolling record of the last stretch of a match: a compact frame per tick for
// scrubbing and reports, the events of each tick, and periodic snapshots to
// re-simulate from.

import { TICK_RATE } from '../sim/constants'
import type { SimEvent } from '../sim/events'
import type { Sim } from '../sim/sim'
import { snapshot, type Snapshot } from '../sim/snapshot'

/** Per-entity values in a frame, in this order. */
export const ENTITY_FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'facing', 'intent', 'target', 'mode'] as const
/** Per-frame values ahead of the entity block, in this order. */
export const FRAME_FIELDS = ['tick', 'phase', 'owner', 'possession', 'half'] as const

export const WINDOW_SECONDS = 30
const KEYFRAME_EVERY = 5 * TICK_RATE

export interface Keyframe {
  tick: number
  snap: Snapshot
}

export class Recorder {
  readonly capacity = WINDOW_SECONDS * TICK_RATE
  /** Entities recorded in each frame: the ball, then the players. */
  readonly entities: number[]
  readonly stride: number
  private frames: Float64Array
  private events: SimEvent[][]
  private head = 0
  private size = 0
  keyframes: Keyframe[] = []

  constructor(sim: Sim) {
    this.entities = [sim.ball, ...sim.players]
    this.stride = FRAME_FIELDS.length + this.entities.length * ENTITY_FIELDS.length
    this.frames = new Float64Array(this.capacity * this.stride)
    this.events = new Array(this.capacity)
  }

  clear(): void {
    this.head = 0
    this.size = 0
    this.keyframes = []
  }

  /** Call before a tick: keeps a snapshot of the state that tick starts from. */
  beforeTick(sim: Sim): void {
    if (sim.m.tick % KEYFRAME_EVERY !== 0 && this.keyframes.length > 0) return
    this.keyframes.push({ tick: sim.m.tick, snap: snapshot(sim) })
    const oldest = this.firstTick()
    while (this.keyframes.length > 1 && this.keyframes[1].tick <= oldest) this.keyframes.shift()
  }

  /** Call after a tick. */
  afterTick(sim: Sim): void {
    const { Pos, Vel, Air, Facing, Intent } = sim.c
    const o = this.head * this.stride
    const f = this.frames
    f[o] = sim.m.tick
    f[o + 1] = sim.m.phase
    f[o + 2] = sim.m.ball.owner
    f[o + 3] = sim.m.possession
    f[o + 4] = sim.m.half
    let k = o + FRAME_FIELDS.length
    for (const eid of this.entities) {
      f[k++] = Pos.x[eid]
      f[k++] = Pos.y[eid]
      f[k++] = Air.z[eid]
      f[k++] = Vel.x[eid]
      f[k++] = Vel.y[eid]
      f[k++] = Facing.a[eid]
      f[k++] = eid === sim.ball ? -1 : Intent.kind[eid]
      f[k++] = eid === sim.ball ? -1 : Intent.target[eid]
      f[k++] = eid === sim.ball ? -1 : Intent.mode[eid]
    }
    this.events[this.head] = sim.m.events
    this.head = (this.head + 1) % this.capacity
    if (this.size < this.capacity) this.size++
  }

  get length(): number {
    return this.size
  }

  firstTick(): number {
    return this.size === 0 ? -1 : this.lastTick() - this.size + 1
  }

  lastTick(): number {
    return this.size === 0 ? -1 : this.frames[((this.head - 1 + this.capacity) % this.capacity) * this.stride]
  }

  private slot(tick: number): number {
    const back = this.lastTick() - tick
    if (back < 0 || back >= this.size) throw new Error(`tick ${tick} is not recorded`)
    return (this.head - 1 - back + this.capacity) % this.capacity
  }

  /** The recorded frame for a tick (a view; copy it to keep it). */
  frame(tick: number): Float64Array {
    const s = this.slot(tick)
    return this.frames.subarray(s * this.stride, (s + 1) * this.stride)
  }

  eventsAt(tick: number): SimEvent[] {
    return this.events[this.slot(tick)]
  }

  /** Latest keyframe at or before a tick. */
  keyframeAtOrBefore(tick: number): Keyframe | undefined {
    let best: Keyframe | undefined
    for (const k of this.keyframes) if (k.tick <= tick) best = k
    return best
  }
}

/** Reads one entity value out of a frame. */
export function frameValue(frame: ArrayLike<number>, index: number, field: (typeof ENTITY_FIELDS)[number]): number {
  return frame[FRAME_FIELDS.length + index * ENTITY_FIELDS.length + ENTITY_FIELDS.indexOf(field)]
}

// The match's event stream. Systems either subscribe with `on` (called the
// moment an event is emitted) or poll with `recentEvents` (this tick and the
// one before). Every event is also kept in `m.events` for the recorder.

import type { Sim } from './sim'
import type { Phase, Restart } from './state'

export type SimEvent =
  | ({ type: 'kick'; tick: number; by: number; kind: KickKind; to: number; x: number; y: number } & KickDetail)
  /** A player's first touch on a loose ball; `clean` is false when it got away from them. */
  | { type: 'control'; tick: number; by: number; x: number; y: number; clean: boolean }
  | { type: 'out'; tick: number; restart: Restart; team: number; x: number; y: number; lastTouch: number }
  | { type: 'goal'; tick: number; team: number; scorer: number }
  | { type: 'phase'; tick: number; phase: Phase }
  /** A player shouts to teammates; `to` hears it, `about` is who it concerns. */
  | { type: 'call'; tick: number; by: number; call: CallKind; to: number; about: number }
  /** A challenge for the ball, resolved the moment the defender gets there. */
  | {
      type: 'tackle'
      tick: number
      by: number
      on: number
      kind: 'standing' | 'slide' | 'charge'
      outcome: 'won' | 'missed' | 'foul'
      /** A slide through the back of the man: endangering an opponent. */
      reckless: boolean
      fromBehind: boolean
      x: number
      y: number
      /** The fouled player's velocity just before the contact. */
      onVx: number
      onVy: number
    }
  /** The referee's decisions. */
  | { type: 'offside'; tick: number; by: number; x: number; y: number }
  | { type: 'foul'; tick: number; by: number; on: number; x: number; y: number; award: 'free-kick' | 'penalty' | 'advantage' }
  | { type: 'card'; tick: number; to: number; color: 'yellow' | 'red'; reason: string }
  /** The ball hit a post or the bar. */
  | { type: 'woodwork'; tick: number; x: number; y: number; z: number }
  /** A goalkeeper gets hands to the ball. */
  | { type: 'save'; tick: number; by: number; kind: 'catch' | 'parry'; speed: number }

export type KickKind = 'pass' | 'touch' | 'restart' | 'shot' | 'header' | 'knock-on' | 'tackle' | 'clearance'
export interface KickDetail {
  /** Pass type name, e.g. "through". */
  pass?: string
  /** Played without controlling the ball first. */
  firstTime?: boolean
}
export type CallKind = 'man-on' | 'give-and-go' | 'keeper'

export type SimEventType = SimEvent['type']
export type EventOf<T extends SimEventType> = Extract<SimEvent, { type: T }>
type WithoutTick<E> = E extends unknown ? Omit<E, 'tick'> : never
export type EventInput = WithoutTick<SimEvent>
export type Listener<T extends SimEventType> = (sim: Sim, e: EventOf<T>) => void
export type Listeners = { [T in SimEventType]?: Listener<T>[] }

export function emit(sim: Sim, input: EventInput): void {
  const e = { ...input, tick: sim.m.tick } as SimEvent
  sim.m.events.push(e)
  const fns = sim.listeners[e.type] as Listener<typeof e.type>[] | undefined
  // Copy so listeners can unsubscribe while being called.
  if (fns) for (const fn of fns.slice()) fn(sim, e as never)
}

export function on<T extends SimEventType>(sim: Sim, type: T, fn: Listener<T>): () => void {
  const list = (sim.listeners[type] ??= []) as Listener<T>[]
  list.push(fn)
  return () => {
    const i = list.indexOf(fn)
    if (i >= 0) list.splice(i, 1)
  }
}

/** Events of a type from the previous tick and this one so far, oldest first. */
export function recentEvents<T extends SimEventType>(sim: Sim, type: T): EventOf<T>[] {
  const out: EventOf<T>[] = []
  for (const e of sim.m.prevEvents) if (e.type === type) out.push(e as EventOf<T>)
  for (const e of sim.m.events) if (e.type === type) out.push(e as EventOf<T>)
  return out
}

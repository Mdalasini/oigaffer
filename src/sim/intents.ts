import type { Sim } from './sim'

/** What a player is currently trying to do. Decided by brains, executed every tick. */
export const IntentKind = {
  Hold: 0,
  Chase: 1,
  Receive: 2,
  Carry: 3,
  Pass: 4,
  Press: 5,
  TakeRestart: 6,
  Wait: 7,
  /** Run to a point, e.g. after a pass in a give-and-go. */
  Run: 8,
  Shoot: 9,
  /** Goalkeeper diving to where a shot will pass. */
  Dive: 10,
  /** Committed to a challenge; mode is the TackleKind. */
  Tackle: 11,
  /** Out of possession: standing in the lane to the target, the carrier's nearest option. */
  CutLane: 12,
} as const
export type IntentKind = (typeof IntentKind)[keyof typeof IntentKind]

export const INTENT_NAMES = Object.fromEntries(Object.entries(IntentKind).map(([k, v]) => [v, k])) as Record<
  IntentKind,
  string
>

/** `mode` refines the intent, e.g. the dribbling style of a Carry. */
export function setIntent(sim: Sim, eid: number, kind: IntentKind, target = -1, x = 0, y = 0, mode = 0): void {
  const { Intent } = sim.c
  Intent.mode[eid] = mode
  if (Intent.kind[eid] !== kind || Intent.target[eid] !== target) Intent.since[eid] = sim.m.tick
  Intent.kind[eid] = kind
  Intent.target[eid] = target
  Intent.x[eid] = x
  Intent.y[eid] = y
}

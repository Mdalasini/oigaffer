import type { SimEvent } from './events'
import { createRng, type Rng } from './rng'

export const Phase = {
  KickOff: 0,
  Play: 1,
  Restart: 2,
  Goal: 3,
  HalfTime: 4,
  FullTime: 5,
} as const
export type Phase = (typeof Phase)[keyof typeof Phase]

export const Restart = {
  KickOff: 0,
  ThrowIn: 1,
  GoalKick: 2,
  Corner: 3,
  FreeKick: 4,
  Penalty: 5,
} as const
export type Restart = (typeof Restart)[keyof typeof Restart]

export interface MatchConfig {
  seed: number
  halfMinutes: number
  formations: [string, string]
}

/**
 * Everything about the match that is not per-entity component data. Must stay
 * JSON-serialisable: snapshots deep-copy it.
 */
export interface MatchState {
  tick: number
  rng: Rng
  half: 1 | 2
  /** Tick the current half kicked off. */
  halfStartTick: number
  phase: Phase
  phaseTick: number
  restart: { kind: Restart; team: number; x: number; y: number; taker: number }
  score: [number, number]
  /** Team that kicked off the first half. */
  firstKickOff: number
  ball: {
    /** Player in control of the ball, or -1 when loose. */
    owner: number
    /** The owner is a goalkeeper holding it in their hands. */
    inHands: boolean
    lastTouch: number
    /** Kind of the last kick ('' after a touch or save). */
    lastKick: string
    /** Team whose player last deliberately passed it with the foot, until an opponent touches it: their keeper may not handle it. */
    backPassTeam: number
    lastTeam: number
    touchTick: number
  }
  /** Team currently in possession, or -1 before the first touch. */
  possession: number
  /** Events emitted during the most recent tick. */
  events: SimEvent[]
  /** Events of the tick before that. */
  prevEvents: SimEvent[]
}

export function createMatchState(cfg: MatchConfig): MatchState {
  return {
    tick: 0,
    rng: createRng(cfg.seed),
    half: 1,
    halfStartTick: 0,
    phase: Phase.KickOff,
    phaseTick: 0,
    restart: { kind: Restart.KickOff, team: 0, x: 0, y: 0, taker: -1 },
    score: [0, 0],
    firstKickOff: 0,
    ball: { owner: -1, inHands: false, lastTouch: -1, lastKick: '', backPassTeam: -1, lastTeam: -1, touchTick: -1 },
    possession: -1,
    events: [],
    prevEvents: [],
  }
}

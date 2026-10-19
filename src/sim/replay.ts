import { FIXED_DT } from './constants'
import { createMatch, requestShot, resetMatch, setGrade, stepMatch, type GradeKey, type Match, type Role } from './match'
import type { TeamName } from './teams'

/**
 * Something done to a match from outside, after `tick` steps and before the
 * next: the only things besides the seed that change how a match plays.
 */
export type Input =
  | { tick: number; kind: 'grade'; team: TeamName; role: Role; key: string; grade: number }
  | { tick: number; kind: 'shoot' }
  | { tick: number; kind: 'reset' }

/**
 * Everything needed to play a match again exactly: the sim is deterministic,
 * so the seed and the inputs, in order, decide every step.
 */
export interface Replay {
  seed: number
  outfielders: number
  inputs: Input[]
}

/** A stretch of a replayed match someone wants looked at, from tick `from` to tick `to`. */
export interface Flag extends Replay {
  from: number
  to: number
  note?: string
  /** The live match's state hash after `tick` steps, so a replay can show it really is the match that was watched. */
  check?: { tick: number; hash: string }
}

export const ticksAt = (seconds: number) => Math.round(seconds / FIXED_DT)
export const secondsAt = (tick: number) => tick * FIXED_DT

/** Applies `input` to `world`. */
export function applyInput(world: Match, input: Input) {
  if (input.kind === 'grade') setGrade(world, input.team, input.role, input.key as GradeKey<Role>, input.grade)
  else if (input.kind === 'shoot') requestShot(world)
  else resetMatch(world)
}

/**
 * Plays a match back, stepping it while `until(world, tick)` holds; `tick` is
 * the number of steps taken so far. `until` sees the match before that
 * tick's inputs are applied, as the live game would have been seen then.
 * Returns the match where it stopped.
 */
export function playBack(replay: Replay, until: (world: Match, tick: number) => boolean): Match {
  const world = createMatch({ seed: replay.seed, outfielders: replay.outfielders })
  let next = 0
  for (let tick = 0; ; tick++) {
    if (!until(world, tick)) return world
    while (next < replay.inputs.length && replay.inputs[next].tick === tick) applyInput(world, replay.inputs[next++])
    stepMatch(world, FIXED_DT)
  }
}

const PREFIX = 'oigaffer-flag:'

/** A flag as one line of text, to copy and paste. */
export function encodeFlag(flag: Flag): string {
  const bytes = new TextEncoder().encode(JSON.stringify(flag))
  return PREFIX + btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
}

export function decodeFlag(text: string): Flag {
  const body = text.trim()
  if (!body.startsWith(PREFIX)) throw new Error(`not a flag: expected it to start with "${PREFIX}"`)
  const bytes = Uint8Array.from(atob(body.slice(PREFIX.length)), (c) => c.charCodeAt(0))
  const flag = JSON.parse(new TextDecoder().decode(bytes)) as Flag
  if (typeof flag.seed !== 'number' || typeof flag.from !== 'number' || typeof flag.to !== 'number' || !Array.isArray(flag.inputs)) {
    throw new Error('not a flag: missing its seed, inputs or window')
  }
  return flag
}

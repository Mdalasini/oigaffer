import { integrateBall, type BallState } from './ballmotion'
import { MAX_ENTITIES } from './components'

/** Ball path prediction: one sample every PATH_STRIDE ticks. */
export const PATH_STRIDE = 3
export const PATH_SAMPLES = 50

export interface Scratch {
  /** Predicted ball x, y, z for each sample; sample 0 is the current position. */
  path: Float64Array
  /** Per team: the player going for a loose ball, or -1. */
  chaser: [number, number]
  /** Per team: the player closing down an opponent on the ball, or -1. */
  presser: [number, number]
  /** Per player: the teammate whose vacated slot they are covering, or -1. */
  cover: Int32Array
  /** Per team: height (attacking-frame x) its back line holds. */
  lineX: [number, number]
  /** Per team: the second man cutting the lane to the carrier's nearest option, and that option. */
  laneCutter: [number, number]
  laneOption: [number, number]
}

export function createScratch(): Scratch {
  return {
    path: new Float64Array(PATH_SAMPLES * 3),
    chaser: [-1, -1],
    presser: [-1, -1],
    cover: new Int32Array(MAX_ENTITIES).fill(-1),
    lineX: [0, 0],
    laneCutter: [-1, -1],
    laneOption: [-1, -1],
  }
}

export function predictPath(out: Float64Array, start: BallState): void {
  const b = { ...start }
  for (let s = 0; s < PATH_SAMPLES; s++) {
    out[s * 3] = b.x
    out[s * 3 + 1] = b.y
    out[s * 3 + 2] = b.z
    for (let i = 0; i < PATH_STRIDE; i++) integrateBall(b)
  }
}

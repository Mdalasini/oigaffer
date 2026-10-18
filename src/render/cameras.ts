import { GOAL_HALF_WIDTH, GOAL_X } from '../sim/constants'
import type { Vec3 } from '../sim/shooting'
import { cross, lookAt, multiply, ortho, type Mat4 } from './mat4'

export interface Camera {
  viewProjection: Mat4
  right: Vec3
  up: Vec3
  /** Direction the camera looks along. */
  forward: Vec3
  /** The ball is drawn larger than life so it stays readable. */
  ballScale: number
}

/** Minimum span of pitch the top-down view keeps on screen, in metres. */
const TOP_HALF_ACROSS = 16
const TOP_HALF_ALONG = 12

/**
 * The main 2D view: an orthographic camera straight above `centre`, with the
 * goal at the top of the screen.
 */
export function topDownCamera(aspect: number, centre: { x: number; y: number }): Camera {
  const eye = { x: centre.x, y: centre.y, z: 100 }
  const { view, right, up } = lookAt(eye, { x: centre.x, y: centre.y, z: 0 }, { x: 1, y: 0, z: 0 })
  const { halfW, halfH } = topDownExtent(aspect)
  const projection = ortho(-halfW, halfW, -halfH, halfH, 1, 200)
  return { viewProjection: multiply(projection, view), right, up, forward: cross(up, right), ballScale: 2 }
}

/** Half-size of the top-down view in metres: across the pitch (screen x) and along it (screen y). */
export function topDownExtent(aspect: number) {
  let halfW = TOP_HALF_ALONG * aspect
  let halfH = TOP_HALF_ALONG
  if (halfW < TOP_HALF_ACROSS) {
    halfW = TOP_HALF_ACROSS
    halfH = TOP_HALF_ACROSS / aspect
  }
  return { halfW, halfH }
}

const GOAL_VIEW_DISTANCE = 12
/** Only draw what is this close to the goal line, so the striker never blocks the view. */
const GOAL_VIEW_DEPTH = 8

/** The inset: the goal mouth face-on, as the striker sees it. */
export function goalCamera(aspect: number): Camera {
  const halfW = GOAL_HALF_WIDTH + 1.9
  const halfH = halfW / aspect
  const centreZ = halfH - 0.45
  const eye = { x: GOAL_X - GOAL_VIEW_DISTANCE, y: 0, z: centreZ }
  const { view, right, up } = lookAt(eye, { x: GOAL_X, y: 0, z: centreZ }, { x: 0, y: 0, z: 1 })
  const projection = ortho(-halfW, halfW, -halfH, halfH, GOAL_VIEW_DISTANCE - GOAL_VIEW_DEPTH, 40)
  return { viewProjection: multiply(projection, view), right, up, forward: cross(up, right), ballScale: 1.6 }
}

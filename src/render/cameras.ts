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

/** World region the top-down view keeps on screen: the final third. */
const TOP_CENTRE_X = 37.5
const TOP_HALF_ACROSS = 24
const TOP_HALF_ALONG = 20

/**
 * The main 2D view: an orthographic camera straight above the attacking half,
 * with the goal at the top of the screen.
 */
export function topDownCamera(aspect: number): Camera {
  const eye = { x: TOP_CENTRE_X, y: 0, z: 100 }
  const { view, right, up } = lookAt(eye, { x: TOP_CENTRE_X, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
  let halfW = TOP_HALF_ALONG * aspect
  let halfH = TOP_HALF_ALONG
  if (halfW < TOP_HALF_ACROSS) {
    halfW = TOP_HALF_ACROSS
    halfH = TOP_HALF_ACROSS / aspect
  }
  const projection = ortho(-halfW, halfW, -halfH, halfH, 1, 200)
  return { viewProjection: multiply(projection, view), right, up, forward: cross(up, right), ballScale: 2.6 }
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

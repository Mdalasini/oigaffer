import { GOAL_DEPTH, GOAL_HALF_WIDTH, PITCH_HALF_LENGTH, PITCH_HALF_WIDTH } from '../sim/constants'
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

/** Space (m) kept around the pitch: the goals stick out past each end. */
const PITCH_MARGIN_ALONG = GOAL_DEPTH + 2
const PITCH_MARGIN_ACROSS = 2
/** Extra room (m) above and below the pitch for the HUD and the goal view. */
const OVERLAY_ROOM = 2.5

/**
 * The main 2D view: an orthographic camera straight above the centre spot
 * that fits the whole pitch. The pitch runs across a landscape screen and up
 * a portrait one.
 */
export function pitchCamera(aspect: number): Camera {
  const along = PITCH_HALF_LENGTH + PITCH_MARGIN_ALONG
  const across = PITCH_HALF_WIDTH + PITCH_MARGIN_ACROSS
  const landscape = aspect >= 1
  // Screen-up is the +y touchline on a landscape screen, the +x goal on a portrait one.
  const up = landscape ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  const [needW, needH] = landscape ? [along, across + OVERLAY_ROOM] : [across, along + OVERLAY_ROOM]
  const halfH = Math.max(needH, needW / aspect)
  const halfW = halfH * aspect
  const { view, right, up: screenUp } = lookAt({ x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 0 }, up)
  const projection = ortho(-halfW, halfW, -halfH, halfH, 1, 200)
  return { viewProjection: multiply(projection, view), right, up: screenUp, forward: cross(screenUp, right), ballScale: 2.5 }
}

const GOAL_VIEW_DISTANCE = 12
/** Only draw what is this close to the goal line, so the attacker never blocks the view. */
const GOAL_VIEW_DEPTH = 8

/** The inset: the goal mouth at `goalX` face-on, as a player attacking it sees it. */
export function goalCamera(aspect: number, goalX: number): Camera {
  const halfW = GOAL_HALF_WIDTH + 1.9
  const halfH = halfW / aspect
  const centreZ = halfH - 0.45
  const eye = { x: goalX - Math.sign(goalX) * GOAL_VIEW_DISTANCE, y: 0, z: centreZ }
  const { view, right, up } = lookAt(eye, { x: goalX, y: 0, z: centreZ }, { x: 0, y: 0, z: 1 })
  const projection = ortho(-halfW, halfW, -halfH, halfH, GOAL_VIEW_DISTANCE - GOAL_VIEW_DEPTH, 40)
  return { viewProjection: multiply(projection, view), right, up, forward: cross(up, right), ballScale: 1.6 }
}

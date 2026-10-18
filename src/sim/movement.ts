import { Effort, MoveIntent, OffBall, Physical, Position } from './components'
import { topSpeed } from './grades'

/** Ground speed (m/s) for each effort level; a sprint is the player's top speed. */
const EFFORT_SPEED: Record<Effort, number> = {
  [Effort.Walk]: 1.8,
  [Effort.Jog]: 4,
  [Effort.Run]: 6.2,
  [Effort.Sprint]: Infinity,
}
/** Players ease off as they arrive, as if braking at this rate (m/s²). */
const ARRIVE_DECEL = 3.5
/** Once settled, a player only sets off again when the target is this many radii away. */
const UNSETTLE_RADII = 1.8
/** Closer than this (m), and no quicker than a jog, players keep facing where they're looking, side-stepping or backing off. */
const FACE_RANGE = 6

/**
 * Carries out an off-ball player's current target: heads there at the
 * chosen effort, eases off on arrival, and then holds still rather than
 * chasing the exact spot. On short, unhurried moves they keep their body
 * facing (faceX, faceY), usually the ball. Longer or quicker moves face the
 * way they're running.
 */
export function steer(eid: number, faceX: number, faceY: number) {
  const dx = OffBall.targetX[eid] - Position.x[eid]
  const dy = OffBall.targetY[eid] - Position.y[eid]
  const distance = Math.hypot(dx, dy)
  const radius = OffBall.radius[eid]
  if (OffBall.settled[eid]) {
    if (distance > radius * UNSETTLE_RADII) OffBall.settled[eid] = 0
  } else if (distance < radius) OffBall.settled[eid] = 1

  const effort = OffBall.effort[eid] as Effort
  if (OffBall.settled[eid]) {
    MoveIntent.vx[eid] = 0
    MoveIntent.vy[eid] = 0
  } else {
    // Aim to stop in the middle of the target area, not at its edge.
    const cruise = Math.min(EFFORT_SPEED[effort], topSpeed(Physical.pace[eid]))
    const speed = Math.min(cruise, Math.sqrt(2 * ARRIVE_DECEL * Math.max(0, distance - radius * 0.5)))
    MoveIntent.vx[eid] = (dx / distance) * speed
    MoveIntent.vy[eid] = (dy / distance) * speed
  }
  const faceWhileMoving = distance < FACE_RANGE && effort <= Effort.Jog
  MoveIntent.faceX[eid] = OffBall.settled[eid] || faceWhileMoving ? faceX : 0
  MoveIntent.faceY[eid] = OffBall.settled[eid] || faceWhileMoving ? faceY : 0
}

/** Sets where an off-ball player is heading, unless it's within the area they're already making for. */
export function setTarget(eid: number, x: number, y: number, radius: number, effort: Effort) {
  const moved = Math.hypot(x - OffBall.targetX[eid], y - OffBall.targetY[eid])
  // Small shifts of the ideal spot don't change where they're going.
  if (moved > OffBall.radius[eid]) {
    OffBall.targetX[eid] = x
    OffBall.targetY[eid] = y
  }
  OffBall.radius[eid] = radius
  OffBall.effort[eid] = effort
}

import { Dribbler, Facing, MoveIntent, Outfielder, Physical, Position, TouchStyle, Velocity } from './components'
import { closeControlSpeed } from './grades'

export interface TouchSpec {
  /** Speed (m/s) the ball gains over the player's own speed in that direction. */
  push: number
  /** Furthest (rad) from the player's facing the ball can be sent. */
  maxAngle: number
  /** Seconds before another touch can be played. */
  cooldown: number
  /** Fraction of the player's speed kept through the touch. */
  stride: number
  /** Multiplier on the player's touch errors. */
  errorScale: number
}

export const TOUCH_SPECS: Record<Exclude<TouchStyle, 0>, TouchSpec> = {
  [TouchStyle.Small]: { push: 1.1, maxAngle: 1.75, cooldown: 0.22, stride: 0.9, errorScale: 1 },
  [TouchStyle.Large]: { push: 5.5, maxAngle: 0.8, cooldown: 0.5, stride: 1, errorScale: 1.6 },
}

/** How far in front of a player's centre their feet play the ball. */
export const FOOT_OFFSET = 0.35
/** How far from the feet the ball can be and still be played. */
export const TOUCH_REACH = 0.6
/** Above this height the ball can't be played with the feet. */
const MAX_TOUCH_HEIGHT = 0.5

export function footX(eid: number) {
  return Position.x[eid] + Math.cos(Facing.angle[eid]) * FOOT_OFFSET
}

export function footY(eid: number) {
  return Position.y[eid] + Math.sin(Facing.angle[eid]) * FOOT_OFFSET
}

export function footDistance(eid: number, ball: number) {
  return Math.hypot(Position.x[ball] - footX(eid), Position.y[ball] - footY(eid))
}

/** Whether `player` can play `ball` right now. */
export function ballAtFeet(player: number, ball: number): boolean {
  if (Position.z[ball] > MAX_TOUCH_HEIGHT) return false
  return Math.hypot(Position.x[ball] - footX(player), Position.y[ball] - footY(player)) <= TOUCH_REACH
}

/**
 * Within this distance (m) of a player's feet the ball is under their control:
 * an opponent has to tackle for it. Beyond it the ball is loose, and a
 * dribbler sprints to get back on it.
 */
export const CONTROL_RADIUS = 1.5
/** How quickly a dribbler closes the gap to where it wants its feet. */
const CHASE_GAIN = 3
/** Seconds ahead a dribbler reads the ball's roll. */
const BALL_LOOKAHEAD = 0.15

/**
 * Sets a player to dribble `ball` towards (dirX, dirY) with `style` touches:
 * run so the feet arrive just behind the ball, matching its roll, and play
 * the touch when it is there. `maxSpeed` slows the carry further, e.g. to
 * probe a defender.
 */
export function dribble(eid: number, ball: number, style: TouchStyle, dirX: number, dirY: number, maxSpeed = Infinity) {
  Dribbler.style[eid] = style
  Dribbler.dirX[eid] = dirX
  Dribbler.dirY[eid] = dirY
  const targetX = Position.x[ball] + Velocity.x[ball] * BALL_LOOKAHEAD - dirX * FOOT_OFFSET
  const targetY = Position.y[ball] + Velocity.y[ball] * BALL_LOOKAHEAD - dirY * FOOT_OFFSET
  let vx = Velocity.x[ball] + (targetX - Position.x[eid]) * CHASE_GAIN
  let vy = Velocity.y[ball] + (targetY - Position.y[eid]) * CHASE_GAIN
  // Keeping the ball close means short strides: no flat-out running, unless
  // the ball has got away and needs chasing down.
  const away = footDistance(eid, ball) > CONTROL_RADIUS
  const closeControl = style === TouchStyle.Small ? closeControlSpeed(Physical.pace[eid], Outfielder.dribbling[eid]) : Infinity
  const cap = away ? Infinity : Math.min(maxSpeed, closeControl)
  const speed = Math.hypot(vx, vy)
  if (speed > cap) {
    vx *= cap / speed
    vy *= cap / speed
  }
  MoveIntent.vx[eid] = vx
  MoveIntent.vy[eid] = vy
}

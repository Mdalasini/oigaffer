import { hasComponent, type World } from 'bitecs'
import { Dribbler, Facing, MoveIntent, OffBalance, Outfielder, Physical, Position, Sliding, TouchStyle, Velocity } from './components'
import { angleDelta } from './angles'
import { GOAL_HALF_WIDTH } from './constants'
import type { Pitch } from './pitch'
import { closeControlSpeed } from './grades'
import { atan2, cos, hypot, sin } from './fmath'

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
  [TouchStyle.Large]: { push: 2.6, maxAngle: 0.8, cooldown: 0.4, stride: 1, errorScale: 1.3 },
  [TouchStyle.Shield]: { push: 0.25, maxAngle: Math.PI, cooldown: 0.3, stride: 0.8, errorScale: 0.5 },
}

/** How far in front of a player's centre their feet play the ball. */
export const FOOT_OFFSET = 0.35
/** How far from the feet the ball can be and still be played. */
export const TOUCH_REACH = 0.6
/** Above this height the ball can't be played with the feet. */
const MAX_TOUCH_HEIGHT = 0.5

export function footX(eid: number) {
  return Position.x[eid] + cos(Facing.angle[eid]) * FOOT_OFFSET
}

export function footY(eid: number) {
  return Position.y[eid] + sin(Facing.angle[eid]) * FOOT_OFFSET
}

export function footDistance(eid: number, ball: number) {
  return hypot(Position.x[ball] - footX(eid), Position.y[ball] - footY(eid))
}

/**
 * Whether a player is in a state to play the ball at all: on their feet and
 * balanced. Every way of playing it (touch, shot, interception) checks this.
 */
export function canPlayBall(world: World, eid: number): boolean {
  return OffBalance.timer[eid] === 0 && !hasComponent(world, eid, Sliding)
}

/** The angle (rad) a touch towards (dirX, dirY) actually goes, given how far the body lets it turn from the facing. */
export function touchAngle(eid: number, style: Exclude<TouchStyle, 0>, dirX: number, dirY: number): number {
  const facing = Facing.angle[eid]
  const maxAngle = TOUCH_SPECS[style].maxAngle
  return facing + Math.max(-maxAngle, Math.min(maxAngle, angleDelta(facing, atan2(dirY, dirX))))
}

/**
 * How far (m) a ball at (x, y) on `pitch` can travel along the unit direction (dx, dy)
 * before leaving the pitch over a touchline or a goal line. Heading into a
 * goal mouth doesn't count as leaving.
 */
export function roomAhead(pitch: Pitch, x: number, y: number, dx: number, dy: number): number {
  const { halfLength: L, halfWidth: W } = pitch
  let room = Infinity
  if (dy !== 0) room = Math.min(room, ((dy > 0 ? W : -W) - y) / dy)
  if (dx !== 0) {
    const t = ((dx > 0 ? L : -L) - x) / dx
    if (Math.abs(y + dy * t) > GOAL_HALF_WIDTH) room = Math.min(room, t)
  }
  return Math.max(0, room)
}

/** Whether `player` can play `ball` right now. */
export function ballAtFeet(player: number, ball: number): boolean {
  if (Position.z[ball] > MAX_TOUCH_HEIGHT) return false
  return hypot(Position.x[ball] - footX(player), Position.y[ball] - footY(player)) <= TOUCH_REACH
}

/**
 * Within this distance (m) of a player's feet the ball is under their control:
 * an opponent has to tackle for it. Beyond it the ball is loose, and a
 * dribbler sprints to get back on it.
 */
export const CONTROL_RADIUS = 1.5
/** How quickly a dribbler closes the gap to where it wants its feet. */
const CHASE_GAIN = 3
/** Slower than this (m/s), a dribbler turns on the spot to face the way they're taking the ball. */
const TURN_ON_BALL_BELOW = 1.5
/** A dribbler with the ball just out of reach runs at least this much faster (m/s) than it rolls, to get back on it. */
const CATCH_UP = 1
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
  // Short strides or not, they have to be able to run the ball down for the next touch.
  const catchUp = ballAtFeet(eid, ball) ? 0 : hypot(Velocity.x[ball], Velocity.y[ball]) + CATCH_UP
  const cap = away ? Infinity : Math.min(maxSpeed, Math.max(closeControl, catchUp))
  const speed = hypot(vx, vy)
  if (speed > cap) {
    vx *= cap / speed
    vy *= cap / speed
  }
  MoveIntent.vx[eid] = vx
  MoveIntent.vy[eid] = vy
  // Barely moving, they turn to face the way they mean to take it, so they can get the ball onto their foot.
  if (hypot(Velocity.x[eid], Velocity.y[eid]) < TURN_ON_BALL_BELOW) {
    MoveIntent.faceX[eid] = dirX
    MoveIntent.faceY[eid] = dirY
  }
}

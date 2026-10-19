import { query } from 'bitecs'
import { OnBall, Dribbler, Facing, Outfielder, Physical, Position, TouchStyle, Velocity } from '../components'
import { BALL_RADIUS } from '../constants'
import { closeControlSpeed, touchAngleError, touchWeightError } from '../grades'
import type { Match } from '../match'
import { playBall } from '../offside'
import { gaussian } from '../rng'
import { ballAtFeet, canPlayBall, touchAngle, TOUCH_SPECS } from '../touch'
import { cos, sin } from '../fmath'

/**
 * Runs down touch cooldowns. It comes first in the step so that decisions
 * (shoot or touch?) and the touch itself see the same readiness.
 */
export function touchCooldownSystem(world: Match, dt: number) {
  for (const eid of query(world, [Dribbler])) Dribbler.cooldown[eid] = Math.max(0, Dribbler.cooldown[eid] - dt)
}

/** Plays each dribbler's chosen touch once the ball is at their feet. */
export function touchSystem(world: Match, _dt: number) {
  for (const eid of query(world, [OnBall, Dribbler, Outfielder, Position, Velocity, Facing])) {
    const style = Dribbler.style[eid] as TouchStyle
    if (style === TouchStyle.None || Dribbler.cooldown[eid] > 0 || !canPlayBall(world, eid)) continue
    if (!ballAtFeet(eid, world.ball)) continue
    if (!playBall(world, eid)) return
    playTouch(world, eid, style)
  }
}

function playTouch(world: Match, eid: number, style: Exclude<TouchStyle, 0>) {
  const spec = TOUCH_SPECS[style]
  const ball = world.ball
  const dribbling = Outfielder.dribbling[eid]
  const intended = touchAngle(eid, style, Dribbler.dirX[eid], Dribbler.dirY[eid])
  const angle = intended + gaussian(world.rng) * touchAngleError(dribbling) * spec.errorScale
  const dx = cos(angle)
  const dy = sin(angle)

  // A small touch keeps it close: never sent on faster than close-control pace, however fast they've run to get back on it.
  const running = Math.max(0, Velocity.x[eid] * dx + Velocity.y[eid] * dy)
  const carried = style === TouchStyle.Small ? Math.min(running, closeControlSpeed(Physical.pace[eid], dribbling)) : running
  const weight = 1 + gaussian(world.rng) * touchWeightError(dribbling) * spec.errorScale
  const speed = Math.max(0, (carried + spec.push) * weight)
  Velocity.x[ball] = dx * speed
  Velocity.y[ball] = dy * speed
  Velocity.z[ball] = 0
  Position.z[ball] = BALL_RADIUS

  Velocity.x[eid] *= spec.stride
  Velocity.y[eid] *= spec.stride
  Dribbler.cooldown[eid] = spec.cooldown
  world.lastTouch = { by: eid, style, time: world.time, x: Position.x[ball], y: Position.y[ball] }
  world.lastTouchedBy = eid
  world.lastTouchDeliberate = true
}

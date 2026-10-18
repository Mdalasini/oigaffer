import { query } from 'bitecs'
import { Attacking, Dribbler, Facing, Outfielder, Position, TouchStyle, Velocity } from '../components'
import { BALL_RADIUS } from '../constants'
import { touchAngleError, touchWeightError } from '../grades'
import type { Match } from '../match'
import { gaussian } from '../rng'
import { ballAtFeet, canPlayBall, touchAngle, TOUCH_SPECS } from '../touch'

/**
 * Runs down touch cooldowns. It comes first in the step so that decisions
 * (shoot or touch?) and the touch itself see the same readiness.
 */
export function touchCooldownSystem(world: Match, dt: number) {
  for (const eid of query(world, [Dribbler])) Dribbler.cooldown[eid] = Math.max(0, Dribbler.cooldown[eid] - dt)
}

/** Plays each dribbler's chosen touch once the ball is at their feet. */
export function touchSystem(world: Match, _dt: number) {
  for (const eid of query(world, [Attacking, Dribbler, Outfielder, Position, Velocity, Facing])) {
    const style = Dribbler.style[eid] as TouchStyle
    if (style === TouchStyle.None || Dribbler.cooldown[eid] > 0 || !canPlayBall(world, eid)) continue
    if (!ballAtFeet(eid, world.ball)) continue
    playTouch(world, eid, style)
  }
}

function playTouch(world: Match, eid: number, style: Exclude<TouchStyle, 0>) {
  const spec = TOUCH_SPECS[style]
  const ball = world.ball
  const dribbling = Outfielder.dribbling[eid]
  const intended = touchAngle(eid, style, Dribbler.dirX[eid], Dribbler.dirY[eid])
  const angle = intended + gaussian(world.rng) * touchAngleError(dribbling) * spec.errorScale
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)

  const carried = Math.max(0, Velocity.x[eid] * dx + Velocity.y[eid] * dy)
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
}

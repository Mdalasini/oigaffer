import { hasComponent, query } from 'bitecs'
import { Body, Defender, DefenderMode, Pressing, Position, Velocity } from '../components'
import { getUp, resolveBarge, resolveSlideTackle, resolveStandingTackle, slideReachesBall } from '../challenge'
import type { Match } from '../match'
import { hypot } from '../fmath'

/** A standing tackle meets the ball this long (s) after it starts, and is over by STAND_DURATION. */
export const STAND_WINDUP = 0.18
const STAND_DURATION = 0.45
/** Sliding defenders decelerate at this rate (m/s²) and stay down this long (s) once stopped. */
const SLIDE_DECEL = 7
const GROUND_TIME = 1.1
/** A barge that hasn't made contact by now (s) is called off. */
const BARGE_DURATION = 0.35

/**
 * Plays out tackles, slides and barges once a player has committed to them.
 * Contact only counts in open play and while still defending, but a slide
 * still runs out and a grounded player still gets up after play stops or the
 * ball changes hands.
 */
export function challengeSystem(world: Match, dt: number) {
  for (const eid of query(world, [Defender, Position, Velocity])) {
    const live = world.phase === 'play' && hasComponent(world, eid, Pressing)
    const mode = Defender.mode[eid]
    if (mode === DefenderMode.Jockey || mode === DefenderMode.Run) continue
    const t = (Defender.actionTime[eid] += dt)

    if (mode === DefenderMode.SlideTackle) {
      slide(world, eid, dt, live)
    } else if (mode === DefenderMode.Grounded) {
      Velocity.x[eid] = Velocity.y[eid] = 0
      if (t >= GROUND_TIME) getUp(world, eid)
    } else if (!live) {
      // A tackle or barge still in its windup when play stops, or the ball changes hands, is called off.
      Defender.mode[eid] = DefenderMode.Jockey
    } else if (mode === DefenderMode.StandTackle) {
      if (!Defender.contacted[eid] && t >= STAND_WINDUP) {
        Defender.contacted[eid] = 1
        resolveStandingTackle(world, eid)
      }
      if (t >= STAND_DURATION) Defender.mode[eid] = DefenderMode.Jockey
    } else if (mode === DefenderMode.Barge) {
      const carrier = world.carrier
      const gap = hypot(Position.x[carrier] - Position.x[eid], Position.y[carrier] - Position.y[eid])
      if (!Defender.contacted[eid] && gap <= Body.radius[carrier] + Body.radius[eid] + 0.08) {
        Defender.contacted[eid] = 1
        resolveBarge(world, eid)
      }
      if (Defender.contacted[eid] || t >= BARGE_DURATION) Defender.mode[eid] = DefenderMode.Run
    }
  }
}

/** Slides along the committed line, under momentum alone, then goes to ground. */
function slide(world: Match, eid: number, dt: number, live: boolean) {
  const speed = Math.max(0, hypot(Velocity.x[eid], Velocity.y[eid]) - SLIDE_DECEL * dt)
  Velocity.x[eid] = Defender.actionDirX[eid] * speed
  Velocity.y[eid] = Defender.actionDirY[eid] * speed
  Position.x[eid] += Velocity.x[eid] * dt
  Position.y[eid] += Velocity.y[eid] * dt
  if (live && !Defender.contacted[eid] && slideReachesBall(world, eid)) {
    Defender.contacted[eid] = 1
    resolveSlideTackle(world, eid)
  }
  if (speed < 0.5) {
    Defender.mode[eid] = DefenderMode.Grounded
    Defender.actionTime[eid] = 0
  }
}

import { query, type World } from 'bitecs'
import { angleDelta, wrapAngle } from '../angles'
import { Facing, MoveIntent, Physical, Position, Velocity } from '../components'
import { accelerationRate, sideStepSpeed, topSpeed, turnRate } from '../grades'

/** Speed at which the turn rate has halved. */
const TURN_FALLOFF_SPEED = 2.5
/** Braking is this much stronger than accelerating. */
const BRAKE_FACTOR = 1.6
/** Below this desired speed, a player with no facing intent keeps its facing. */
const MIN_STEER_SPEED = 0.3

/**
 * Moves players towards their MoveIntent. Bodies accelerate hardest along the
 * way they face; sidestepping and backpedalling are slow, and turning gets
 * slower the faster a player runs, so direction changes cost time.
 */
export function locomotionSystem(world: World, dt: number) {
  for (const eid of query(world, [Position, Velocity, Facing, MoveIntent, Physical])) {
    const vx = Velocity.x[eid]
    const vy = Velocity.y[eid]
    const speed = Math.hypot(vx, vy)
    const dvx = MoveIntent.vx[eid]
    const dvy = MoveIntent.vy[eid]

    let faceX = MoveIntent.faceX[eid]
    let faceY = MoveIntent.faceY[eid]
    if (faceX === 0 && faceY === 0 && Math.hypot(dvx, dvy) > MIN_STEER_SPEED) {
      faceX = dvx
      faceY = dvy
    }
    if (faceX !== 0 || faceY !== 0) {
      const maxTurn = (turnRate(Physical.agility[eid]) / (1 + speed / TURN_FALLOFF_SPEED)) * dt
      const delta = angleDelta(Facing.angle[eid], Math.atan2(faceY, faceX))
      Facing.angle[eid] = wrapAngle(Facing.angle[eid] + clamp(delta, -maxTurn, maxTurn))
    }

    // Work in the body frame: forward along the facing, lateral to its left.
    const fx = Math.cos(Facing.angle[eid])
    const fy = Math.sin(Facing.angle[eid])
    const forward = vx * fx + vy * fy
    const lateral = -vx * fy + vy * fx
    const side = sideStepSpeed(Physical.agility[eid])
    const top = topSpeed(Physical.pace[eid])
    let wantForward = clamp(dvx * fx + dvy * fy, -side, top)
    let wantLateral = clamp(-dvx * fy + dvy * fx, -side, side)
    // Running on a diagonal is still bounded by top speed overall.
    const wantSpeed = Math.hypot(wantForward, wantLateral)
    if (wantSpeed > top) {
      wantForward *= top / wantSpeed
      wantLateral *= top / wantSpeed
    }

    const accel = accelerationRate(Physical.acceleration[eid]) * dt
    const newForward = approach(forward, wantForward, accel, accel * BRAKE_FACTOR)
    const newLateral = approach(lateral, wantLateral, accel, accel * BRAKE_FACTOR)

    Velocity.x[eid] = newForward * fx - newLateral * fy
    Velocity.y[eid] = newForward * fy + newLateral * fx
    Position.x[eid] += Velocity.x[eid] * dt
    Position.y[eid] += Velocity.y[eid] * dt
  }
}

/**
 * Moves the speed `value` towards `target` within one step, gaining at most
 * `up` and shedding at most `down`. A reversal brakes to a stop first and
 * spends only the rest of the step speeding up the other way.
 */
function approach(value: number, target: number, up: number, down: number): number {
  if (value !== 0 && Math.sign(target) !== Math.sign(value)) {
    if (Math.abs(value) >= down) return value - Math.sign(value) * down
    up *= 1 - Math.abs(value) / down
    value = 0
  }
  const limit = Math.abs(target) >= Math.abs(value) ? up : down
  return value + clamp(target - value, -limit, limit)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

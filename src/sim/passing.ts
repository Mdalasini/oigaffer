import { BALL_ROLL_DECEL, BALL_ROLL_DRAG } from './constants'

/** The ball's rolling slowdown is BALL_ROLL_DECEL + BALL_ROLL_DRAG × speed; this is their ratio. */
const K = BALL_ROLL_DECEL / BALL_ROLL_DRAG

/** Distance (m) a ball rolled at `from` m/s covers by the time it has slowed to `to` m/s. */
export function rollDistance(from: number, to: number): number {
  const t = Math.log((from + K) / (to + K)) / BALL_ROLL_DRAG
  return (from - to) / BALL_ROLL_DRAG - K * t
}

/** Speed (m/s) to roll a ball so it arrives `distance` metres away still moving at `arrival` m/s. */
export function rollSpeedFor(distance: number, arrival: number): number {
  let lo = arrival
  let hi = 40
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (rollDistance(mid, arrival) < distance) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Seconds a ball rolled at `from` m/s takes to come to rest. */
export function rollStopTime(from: number): number {
  return Math.log((from + K) / K) / BALL_ROLL_DRAG
}

/** Distance (m) a ball rolled at `from` m/s covers in `t` seconds. */
export function rollDistanceIn(from: number, t: number): number {
  const s = Math.min(t, rollStopTime(from))
  return ((from + K) * (1 - Math.exp(-BALL_ROLL_DRAG * s))) / BALL_ROLL_DRAG - K * s
}

/** Seconds a ball rolled at `from` m/s takes to cover `distance` metres; Infinity if it stops short. */
export function rollTime(from: number, distance: number): number {
  if (distance <= 0) return 0
  let hi = rollStopTime(from)
  if (rollDistanceIn(from, hi) < distance) return Infinity
  let lo = 0
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (rollDistanceIn(from, mid) < distance) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Speed (m/s) of a ball rolled at `from` m/s after `t` seconds. */
export function rollSpeedAfter(from: number, t: number): number {
  if (t >= rollStopTime(from)) return 0
  return (from + K) * Math.exp(-BALL_ROLL_DRAG * t) - K
}

/** Speed (m/s) to roll a ball so it covers `distance` metres in `time` seconds; Infinity if no speed is quick enough. */
export function rollSpeedToArrive(distance: number, time: number): number {
  let lo = 0
  let hi = 60
  if (rollTime(hi, distance) > time) return Infinity
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (rollTime(mid, distance) > time) lo = mid
    else hi = mid
  }
  return hi
}

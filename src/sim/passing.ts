import { BALL_ROLL_DECEL, BALL_ROLL_DRAG } from './constants'

/** The ball's rolling slowdown is BALL_ROLL_DECEL + BALL_ROLL_DRAG × speed; this is their ratio. */
const K = BALL_ROLL_DECEL / BALL_ROLL_DRAG

/** Distance (m) a ball rolled at `from` m/s covers by the time it has slowed to `to` m/s. */
export function rollDistance(from: number, to: number): number {
  const t = Math.log((from + K) / (to + K)) / BALL_ROLL_DRAG
  return (from - to) / BALL_ROLL_DRAG - K * t
}

/** The fastest a ball is rolled to arrive at a given pace (m/s), and to arrive in a given time. */
const FASTEST_ROLL = 40
const ROLL_LIMIT = 60
/** The pace (m/s) of a ball that only just gets there. */
const ARRIVES_AT_ALL = 1e-6

/** Speed (m/s) to roll a ball so it arrives `distance` metres away still moving at `arrival` m/s. */
export function rollSpeedFor(distance: number, arrival: number): number {
  return speedToReach(distance, arrival, FASTEST_ROLL)
}

/** As `rollSpeedFor`, but never faster than `limit`: a ball that can't get there at that speed is struck at it. */
function speedToReach(distance: number, arrival: number, limit: number): number {
  if (distance <= 0) return arrival
  if (rollDistance(limit, arrival) <= distance) return limit
  // The distance grows faster and faster with the speed, so Newton's method from above closes in without overshooting.
  let from = limit
  for (let i = 0; i < 50; i++) {
    const step = ((rollDistance(from, arrival) - distance) * BALL_ROLL_DRAG * (from + K)) / from
    from = Math.max(arrival, from - step)
    if (Math.abs(step) < 1e-10) break
  }
  return from
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
export function rollTime(from: number, distance: number, after = 0): number {
  if (distance <= 0) return 0
  const stop = rollStopTime(from)
  if (rollDistanceIn(from, stop) < distance) return Infinity
  // The ball only slows, so Newton's method from any earlier time closes in without overshooting.
  // `after` is a time known to be no later than the answer, such as the time to a nearer point.
  let t = Math.min(after, stop)
  for (let i = 0; i < 60; i++) {
    const speed = rollSpeedAfter(from, t)
    if (speed <= 0) break
    const step = (distance - rollDistanceIn(from, t)) / speed
    t = Math.min(stop, t + step)
    if (step < 1e-10) break
  }
  return t
}

/** Speed (m/s) of a ball rolled at `from` m/s after `t` seconds. */
export function rollSpeedAfter(from: number, t: number): number {
  if (t >= rollStopTime(from)) return 0
  return (from + K) * Math.exp(-BALL_ROLL_DRAG * t) - K
}

/** Speed (m/s) to roll a ball so it covers `distance` metres in `time` seconds; Infinity if no speed is quick enough. */
export function rollSpeedToArrive(distance: number, time: number): number {
  if (distance <= 0) return 0
  if (time <= 0) return Infinity
  // Still rolling at `time`, the distance covered is linear in the starting speed.
  const from = ((distance + K * time) * BALL_ROLL_DRAG) / (1 - Math.exp(-BALL_ROLL_DRAG * time)) - K
  if (rollStopTime(from) < time) {
    // A ball that slow would stop first: the slowest one that gets there at all arrives sooner.
    // It's given a hair of pace at the end, so rounding can't leave it stopping just short.
    if (rollDistance(ROLL_LIMIT, ARRIVES_AT_ALL) < distance) return Infinity
    return speedToReach(distance, ARRIVES_AT_ALL, ROLL_LIMIT)
  }
  return from > ROLL_LIMIT ? Infinity : from
}

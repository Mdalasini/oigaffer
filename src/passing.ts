import {
  BALL_ROLLING_DECELERATION,
  DEFENDER_REACTION_TIME,
  HARDEST_PASS,
  HIGHEST_BLOCK,
  INTERCEPTING_SPEED,
  PASS_ARRIVAL_SPEED,
  TACKLE_REACH,
  TOUCH_REACH,
} from "./constants";
import { straightFlight, type StraightFlight } from "./flight";
import { bestInterception, firstMovingStep, type Interception, type Mover } from "./interception";
import type { Point } from "./shooting";

export const INTERCEPTOR: Mover = { reach: TACKLE_REACH, speed: INTERCEPTING_SPEED, highest: HIGHEST_BLOCK, reaction: DEFENDER_REACTION_TIME };

const LEADING_ROUNDS = 4;

const speedToArriveAt = (distance: number) => Math.sqrt(PASS_ARRIVAL_SPEED ** 2 + 2 * BALL_ROLLING_DECELERATION * distance);

export type Pass = { to: Point; velocity: Point };

export function leadPass(from: Point, receiver: [x: number, y: number], receiverVelocity: [vx: number, vy: number]): Pass | null {
  let to: Point = [receiver[0], receiver[1], 0];
  let speed = 0;
  for (let round = 0; round < LEADING_ROUNDS; round++) {
    speed = speedToArriveAt(Math.hypot(to[0] - from[0], to[1] - from[1]));
    const travel = (speed - PASS_ARRIVAL_SPEED) / BALL_ROLLING_DECELERATION;
    to = [receiver[0] + receiverVelocity[0] * travel, receiver[1] + receiverVelocity[1] * travel, 0];
  }
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  speed = speedToArriveAt(distance);
  if (speed > HARDEST_PASS || distance === 0) return null;
  return { to, velocity: [((to[0] - from[0]) / distance) * speed, ((to[1] - from[1]) / distance) * speed, 0] };
}

export function untilCollected(flight: StraightFlight, length: number): StraightFlight {
  const collected = flight.along.findIndex((along) => along >= length - TOUCH_REACH);
  const steps = collected < 0 ? flight.along.length : collected + 1;
  return {
    ...flight,
    along: flight.along.slice(0, steps),
    stepLength: flight.stepLength.slice(0, steps),
    height: flight.height.slice(0, steps),
    climb: flight.climb.slice(0, steps),
  };
}

export function passFlight(from: Point, pass: Pass, dt: number): StraightFlight | null {
  const flight = straightFlight(from, pass.velocity, dt);
  return flight && untilCollected(flight, Math.hypot(pass.to[0] - from[0], pass.to[1] - from[1]));
}

export function interceptionOf(flight: StraightFlight, defender: [x: number, y: number], dt: number, delay = 0): Interception | null {
  const movingFrom = Math.max(firstMovingStep(INTERCEPTOR, dt), Math.ceil(delay / dt));
  return bestInterception(INTERCEPTOR, defender, flight, (step) => step + 1 - movingFrom, dt);
}

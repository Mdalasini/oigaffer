import { firstStepAlongFrom, type StraightFlight } from "./flight";
import type { Point } from "./shooting";

export type Mover = { reach: number; speed: number; highest: number; reaction: number };
export type Interception = { point: Point; shortfall: number };

export const hasReacted = (mover: Mover, watchedFor: number, dt: number) => watchedFor + dt / 2 >= mover.reaction;

export const firstMovingStep = (mover: Mover, dt: number) => Math.ceil(mover.reaction / dt - 0.5);

const reachAfterMoving = (mover: Mover, steps: number, dt: number) => mover.reach + mover.speed * Math.max(0, steps) * dt;

export const isWithinReach = (mover: Mover, [moverX, moverY]: [x: number, y: number], [x, y, z]: Point) =>
  Math.hypot(x - moverX, y - moverY) <= mover.reach && z <= mover.highest;

export function bestInterception(
  mover: Mover,
  [moverX, moverY]: [x: number, y: number],
  flight: StraightFlight,
  movingStepsBy: (step: number) => number,
  dt: number,
): Interception | null {
  const { fromX, fromY, directionX, directionY, along, stepLength, height, climb } = flight;
  const steps = along.length;
  if (steps === 0) return null;
  const moverAlong = (moverX - fromX) * directionX + (moverY - fromY) * directionY;
  const moverAcross = (moverX - fromX) * directionY - (moverY - fromY) * directionX;
  const furthestReach = reachAfterMoving(mover, movingStepsBy(steps - 1), dt);
  let best: { along: number; z: number; shortfall: number } | null = null;
  let previousShortfall = Infinity;
  for (let step = firstStepAlongFrom(along, moverAlong - furthestReach); step < steps; step++) {
    const length = stepLength[step]!;
    const start = along[step]! - length;
    const share = length > 0 ? Math.max(0, Math.min(1, (moverAlong - start) / length)) : 1;
    const passAlong = start + length * share;
    const z = Math.max(0, height[step]! - climb[step]! + climb[step]! * share);
    const shortfall = Math.hypot(passAlong - moverAlong, moverAcross) - reachAfterMoving(mover, movingStepsBy(step), dt);
    if (z <= mover.highest && (!best || shortfall < best.shortfall)) best = { along: passAlong, z, shortfall };
    if (best && best.shortfall <= 0) break;
    const gettingAway = along[step]! > moverAlong && length > mover.speed * dt && shortfall > previousShortfall;
    if (gettingAway) break;
    previousShortfall = shortfall;
  }
  if (!best) return null;
  return { point: [fromX + directionX * best.along, fromY + directionY * best.along, best.z], shortfall: best.shortfall };
}

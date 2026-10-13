import { KEEPER_DIVE_SPEED, KEEPER_HIGHEST_REACH, KEEPER_REACH, KEEPER_REACTION_TIME } from "./constants";
import type { StraightFlight } from "./flight";
import type { Point } from "./shooting";

export type Keeper = [x: number, y: number];
export type Interception = { point: Point; shortfall: number };

export const hasReacted = (watchedFor: number, dt: number) => watchedFor + dt / 2 >= KEEPER_REACTION_TIME;

export const firstDivingStep = (dt: number) => Math.ceil(KEEPER_REACTION_TIME / dt - 0.5);

const reachAfterDiving = (steps: number, dt: number) => KEEPER_REACH + KEEPER_DIVE_SPEED * Math.max(0, steps) * dt;

export const isWithinReach = ([keeperX, keeperY]: Keeper, [x, y, z]: Point) =>
  Math.hypot(x - keeperX, y - keeperY) <= KEEPER_REACH && z <= KEEPER_HIGHEST_REACH;

function firstStepAlongFrom(along: number[], distance: number): number {
  let low = 0;
  let high = along.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (along[middle]! < distance) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function bestInterception(
  [keeperX, keeperY]: Keeper,
  flight: StraightFlight,
  divingStepsBy: (step: number) => number,
  dt: number,
): Interception | null {
  const { fromX, fromY, directionX, directionY, along, stepLength, height, climb } = flight;
  const steps = along.length;
  if (steps === 0) return null;
  const keeperAlong = (keeperX - fromX) * directionX + (keeperY - fromY) * directionY;
  const keeperAcross = (keeperX - fromX) * directionY - (keeperY - fromY) * directionX;
  const furthestReach = reachAfterDiving(divingStepsBy(steps - 1), dt);
  let best: { along: number; z: number; shortfall: number } | null = null;
  let previousShortfall = Infinity;
  for (let step = firstStepAlongFrom(along, keeperAlong - furthestReach); step < steps; step++) {
    const length = stepLength[step]!;
    const start = along[step]! - length;
    const share = length > 0 ? Math.max(0, Math.min(1, (keeperAlong - start) / length)) : 1;
    const passAlong = start + length * share;
    const z = Math.max(0, height[step]! - climb[step]! + climb[step]! * share);
    const shortfall = Math.hypot(passAlong - keeperAlong, keeperAcross) - reachAfterDiving(divingStepsBy(step), dt);
    if (z <= KEEPER_HIGHEST_REACH && (!best || shortfall < best.shortfall)) best = { along: passAlong, z, shortfall };
    if (best && best.shortfall <= 0) break;
    const gettingAway = along[step]! > keeperAlong && length > KEEPER_DIVE_SPEED * dt && shortfall > previousShortfall;
    if (gettingAway) break;
    previousShortfall = shortfall;
  }
  if (!best) return null;
  return { point: [fromX + directionX * best.along, fromY + directionY * best.along, best.z], shortfall: best.shortfall };
}

import { KEEPER_DIVE_SPEED, KEEPER_HIGHEST_REACH, KEEPER_REACH, KEEPER_REACTION_TIME } from "./constants";
import { closestPassThisStep, GOAL_LINE, hasCrossed } from "./flight";
import type { Point } from "./shooting";

export type Keeper = [x: number, y: number];
export type Interception = { point: Point; shortfall: number };

export const hasReacted = (watchedFor: number, dt: number) => watchedFor + dt / 2 >= KEEPER_REACTION_TIME;

export const firstDivingStep = (dt: number) => Math.ceil(KEEPER_REACTION_TIME / dt - 0.5);

const reachAfterDiving = (steps: number, dt: number) => KEEPER_REACH + KEEPER_DIVE_SPEED * Math.max(0, steps) * dt;

export function bestInterception(
  [keeperX, keeperY]: Keeper,
  flight: Iterable<[position: Point, velocity: Point]>,
  divingStepsBy: (step: number) => number,
  dt: number,
): Interception | null {
  let best: Interception | null = null;
  let step = 0;
  for (const [position, velocity] of flight) {
    const point = closestPassThisStep(keeperX, keeperY, position, velocity, dt);
    const shortfall = Math.hypot(point[0] - keeperX, point[1] - keeperY) - reachAfterDiving(divingStepsBy(step), dt);
    step++;
    if (point[2] <= KEEPER_HIGHEST_REACH && (!best || shortfall < best.shortfall)) best = { point, shortfall };
    if (best && best.shortfall <= 0) return best;
    if (hasCrossed(GOAL_LINE, position)) break;
  }
  return best;
}

export const isWithinReach = ([keeperX, keeperY]: Keeper, [x, y, z]: Point) =>
  Math.hypot(x - keeperX, y - keeperY) <= KEEPER_REACH && z <= KEEPER_HIGHEST_REACH;

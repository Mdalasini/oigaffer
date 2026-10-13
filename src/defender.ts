import {
  ACCELERATION,
  BLOCKING_REACH,
  EVEN_TACKLE_WIN_CHANCE,
  HIGHEST_BLOCK,
  LOPSIDED_TACKLE_WIN_CHANCE,
} from "./constants";
import { firstStepAlongFrom, type StraightFlight } from "./flight";
import { skill } from "./grade";

export type Defender = [x: number, y: number];

export const tackleWinChance = (tackling: number, dribbling: number) =>
  EVEN_TACKLE_WIN_CHANCE + (LOPSIDED_TACKLE_WIN_CHANCE - EVEN_TACKLE_WIN_CHANCE) * (skill(tackling) - skill(dribbling));

export const isWithinBlockingReach = ([defenderX, defenderY]: Defender, [x, y, z]: [number, number, number]) =>
  Math.hypot(x - defenderX, y - defenderY) <= BLOCKING_REACH && z <= HIGHEST_BLOCK;

export function blocks([defenderX, defenderY]: Defender, flight: StraightFlight): boolean {
  const { fromX, fromY, directionX, directionY, along, stepLength, height, climb } = flight;
  const defenderAlong = (defenderX - fromX) * directionX + (defenderY - fromY) * directionY;
  const defenderAcross = (defenderX - fromX) * directionY - (defenderY - fromY) * directionX;
  if (Math.abs(defenderAcross) > BLOCKING_REACH) return false;
  for (let step = firstStepAlongFrom(along, defenderAlong - BLOCKING_REACH); step < along.length; step++) {
    const length = stepLength[step]!;
    const start = along[step]! - length;
    if (start > defenderAlong + BLOCKING_REACH) return false;
    const share = length > 0 ? Math.max(0, Math.min(1, (defenderAlong - start) / length)) : 1;
    const z = Math.max(0, height[step]! - climb[step]! + climb[step]! * share);
    if (Math.hypot(start + length * share - defenderAlong, defenderAcross) <= BLOCKING_REACH && z <= HIGHEST_BLOCK) return true;
  }
  return false;
}

export function timeToRun(distance: number, topSpeed: number): number {
  const speedingUp = (topSpeed * topSpeed) / (2 * ACCELERATION);
  if (distance <= speedingUp) return Math.sqrt((2 * distance) / ACCELERATION);
  return topSpeed / ACCELERATION + (distance - speedingUp) / topSpeed;
}

import {
  BEST_SHOOTING_GRADE,
  BEST_SHOOTING_SPREAD,
  GRAVITY,
  MAX_RELEASE_ANGLE,
  STRONGEST_STRIKE_SPEED,
  WEAKEST_STRIKE_SPEED,
  WORST_SHOOTING_GRADE,
  WORST_SHOOTING_SPREAD,
} from "./constants";
import type { Random } from "./random";

export type Point = [x: number, y: number, z: number];

const SEARCH_STEPS = 60;

const horizontalDistance = (from: Point, to: Point) => Math.hypot(to[0] - from[0], to[1] - from[1]);
const straightDistance = (from: Point, to: Point) => Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
const skill = (grade: number) => (grade - WORST_SHOOTING_GRADE) / (BEST_SHOOTING_GRADE - WORST_SHOOTING_GRADE);

export const strikeSpeed = (grade: number) => WEAKEST_STRIKE_SPEED + (STRONGEST_STRIKE_SPEED - WEAKEST_STRIKE_SPEED) * skill(grade);

export const spreadAngle = (grade: number) => WORST_SHOOTING_SPREAD + (BEST_SHOOTING_SPREAD - WORST_SHOOTING_SPREAD) * skill(grade);

function reachingPath(from: Point, to: Point) {
  const distance = horizontalDistance(from, to);
  const rise = to[2] - from[2];
  const carry = (angle: number) => Math.cos(angle) ** 4 * (distance * Math.tan(angle) - rise);
  const flattest = Math.min(MAX_RELEASE_ANGLE, Math.max(0, Math.atan2(rise, distance)));
  let low = flattest;
  let high = MAX_RELEASE_ANGLE;
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const third = (high - low) / 3;
    if (carry(low + third) < carry(high - third)) low += third;
    else high -= third;
  }
  return { distance, carry, flattest, easiest: (low + high) / 2 };
}

export function neededStrikeSpeed(from: Point, to: Point): number {
  const { distance, carry, easiest } = reachingPath(from, to);
  if (carry(easiest) <= 0) return Infinity;
  return Math.sqrt((GRAVITY * distance * distance) / (2 * carry(easiest)));
}

export function releaseAngle(from: Point, to: Point, strike: number): number {
  const { distance, carry, flattest, easiest } = reachingPath(from, to);
  const carryNeeded = (GRAVITY * distance * distance) / (2 * strike * strike);
  if (carry(easiest) <= carryNeeded) return easiest;
  let low = flattest;
  let high = easiest;
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const middle = (low + high) / 2;
    if (carry(middle) < carryNeeded) low = middle;
    else high = middle;
  }
  return high;
}

export function kick(from: Point, to: Point, strike: number): Point {
  const distance = horizontalDistance(from, to);
  const angle = releaseAngle(from, to, strike);
  const speed = strike * Math.cos(angle);
  const onwardX = distance > 0 ? (to[0] - from[0]) / distance : 0;
  const onwardY = distance > 0 ? (to[1] - from[1]) / distance : 0;
  return [onwardX * speed * Math.cos(angle), onwardY * speed * Math.cos(angle), speed * Math.sin(angle)];
}

export function spreadRadius(grade: number, from: Point, aim: Point): number {
  const harderThanNeeded = Math.max(1, strikeSpeed(grade) / neededStrikeSpeed(from, aim));
  return spreadAngle(grade) * straightDistance(from, aim) * harderThanNeeded;
}

export function acrossTheShot(from: Point, aim: Point): [x: number, y: number] {
  const distance = horizontalDistance(from, aim);
  return distance > 0 ? [-(aim[1] - from[1]) / distance, (aim[0] - from[0]) / distance] : [0, 1];
}

export function missAim(from: Point, aim: Point, radius: number, random: Random): Point {
  const [acrossX, acrossY] = acrossTheShot(from, aim);
  const angle = random() * 2 * Math.PI;
  const offset = radius * Math.sqrt(random());
  const across = offset * Math.cos(angle);
  const up = offset * Math.sin(angle);
  return [aim[0] + acrossX * across, aim[1] + acrossY * across, aim[2] + up];
}

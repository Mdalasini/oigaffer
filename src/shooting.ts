import {
  BEST_SHOOTING_GRADE,
  BEST_SHOOTING_SPREAD,
  GRAVITY,
  MAX_SHOT_SPEED,
  WORST_SHOOTING_GRADE,
  WORST_SHOOTING_SPREAD,
} from "./constants";
import type { Random } from "./random";

export type Point = [x: number, y: number, z: number];

const horizontalDistance = (from: Point, to: Point) => Math.hypot(to[0] - from[0], to[1] - from[1]);
const straightDistance = (from: Point, to: Point) => Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);

export function neededShotSpeed(from: Point, to: Point): number {
  const rise = to[2] - from[2];
  return Math.sqrt(GRAVITY * (rise + straightDistance(from, to)));
}

export function spreadAngle(grade: number): number {
  const skill = (grade - WORST_SHOOTING_GRADE) / (BEST_SHOOTING_GRADE - WORST_SHOOTING_GRADE);
  return WORST_SHOOTING_SPREAD + (BEST_SHOOTING_SPREAD - WORST_SHOOTING_SPREAD) * skill;
}

export function spreadRadius(grade: number, from: Point, aim: Point, speed: number): number {
  const powerOverNeeded = Math.max(1, Math.min(speed, MAX_SHOT_SPEED) / neededShotSpeed(from, aim));
  return spreadAngle(grade) * straightDistance(from, aim) * powerOverNeeded;
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

export function launchVelocity(from: Point, to: Point, speed: number): Point {
  const distance = horizontalDistance(from, to);
  const rise = to[2] - from[2];
  const speedSquared = speed * speed;
  const reach = speedSquared * speedSquared - GRAVITY * (GRAVITY * distance * distance + 2 * rise * speedSquared);
  const lift = Math.atan2(speedSquared - Math.sqrt(Math.max(0, reach)), GRAVITY * distance);
  const onwardX = distance > 0 ? (to[0] - from[0]) / distance : 0;
  const onwardY = distance > 0 ? (to[1] - from[1]) / distance : 0;
  return [onwardX * speed * Math.cos(lift), onwardY * speed * Math.cos(lift), speed * Math.sin(lift)];
}

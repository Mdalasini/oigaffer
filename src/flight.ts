import { BALL_BOUNCE_RESTITUTION, BALL_ROLLING_DECELERATION, GRAVITY, PITCH_LENGTH, SETTLING_SPEED } from "./constants";
import type { Point } from "./shooting";

export type Plane = { x: number; y: number; normalX: number; normalY: number };

export const GOAL_LINE: Plane = { x: PITCH_LENGTH, y: 0, normalX: 1, normalY: 0 };

export function acrossThePath(x: number, y: number, velocity: Point): Plane | null {
  const speed = Math.hypot(velocity[0], velocity[1]);
  return speed > 0 ? { x, y, normalX: velocity[0] / speed, normalY: velocity[1] / speed } : null;
}

const beyond = (plane: Plane, x: number, y: number) => (x - plane.x) * plane.normalX + (y - plane.y) * plane.normalY;
const closingSpeed = (plane: Plane, velocity: Point) => velocity[0] * plane.normalX + velocity[1] * plane.normalY;

export const isOnTheGround = (z: number, vz: number) => z === 0 && vz === 0;

export function rolling(vx: number, vy: number, dt: number): [vx: number, vy: number] {
  const speed = Math.hypot(vx, vy);
  if (speed === 0) return [0, 0];
  const share = Math.max(0, speed - BALL_ROLLING_DECELERATION * dt) / speed;
  return [vx * share, vy * share];
}

export function flying(z: number, vz: number, dt: number): [z: number, vz: number] {
  const nextZ = z + vz * dt - 0.5 * GRAVITY * dt * dt;
  const nextVz = vz - GRAVITY * dt;
  if (nextZ > 0) return [nextZ, nextVz];
  const bounceSpeed = -nextVz * BALL_BOUNCE_RESTITUTION;
  return [0, bounceSpeed < SETTLING_SPEED ? 0 : bounceSpeed];
}

export function crossing(plane: Plane, position: Point, velocity: Point): Point {
  const timeSinceCrossing = beyond(plane, position[0], position[1]) / closingSpeed(plane, velocity);
  return [
    position[0] - velocity[0] * timeSinceCrossing,
    position[1] - velocity[1] * timeSinceCrossing,
    Math.max(0, position[2] - velocity[2] * timeSinceCrossing),
  ];
}

export const hasCrossed = (plane: Plane, position: Point) => beyond(plane, position[0], position[1]) >= 0;

export function whereBallCrosses(plane: Plane, position: Point, velocity: Point, dt: number): Point | null {
  let [x, y, z] = position;
  let [vx, vy, vz] = velocity;
  if (hasCrossed(plane, position)) return null;
  while (closingSpeed(plane, [vx, vy, vz]) > 0) {
    if (isOnTheGround(z, vz)) [vx, vy] = rolling(vx, vy, dt);
    else [z, vz] = flying(z, vz, dt);
    x += vx * dt;
    y += vy * dt;
    if (hasCrossed(plane, [x, y, z])) return crossing(plane, [x, y, z], [vx, vy, vz]);
  }
  return null;
}

export function closestPassThisStep(x: number, y: number, position: Point, velocity: Point, dt: number): Point {
  const [moveX, moveY, moveZ] = [velocity[0] * dt, velocity[1] * dt, velocity[2] * dt];
  const [fromX, fromY, fromZ] = [position[0] - moveX, position[1] - moveY, position[2] - moveZ];
  const length = moveX * moveX + moveY * moveY;
  const share = length > 0 ? Math.max(0, Math.min(1, ((x - fromX) * moveX + (y - fromY) * moveY) / length)) : 1;
  return [fromX + moveX * share, fromY + moveY * share, Math.max(0, fromZ + moveZ * share)];
}

import { BALL_BOUNCE_RESTITUTION, BALL_ROLLING_DECELERATION, GRAVITY, SETTLING_SPEED } from "./constants";
import type { Point } from "./shooting";

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

export function crossing(lineX: number, position: Point, velocity: Point): [y: number, z: number] {
  const timeSinceCrossing = (position[0] - lineX) / velocity[0];
  return [position[1] - velocity[1] * timeSinceCrossing, Math.max(0, position[2] - velocity[2] * timeSinceCrossing)];
}

export function whereBallCrosses(lineX: number, position: Point, velocity: Point, dt: number): [y: number, z: number] | null {
  let [x, y, z] = position;
  let [vx, vy, vz] = velocity;
  if (x >= lineX) return null;
  while (vx > 0) {
    if (isOnTheGround(z, vz)) [vx, vy] = rolling(vx, vy, dt);
    else [z, vz] = flying(z, vz, dt);
    x += vx * dt;
    y += vy * dt;
    if (x >= lineX) return crossing(lineX, [x, y, z], [vx, vy, vz]);
  }
  return null;
}

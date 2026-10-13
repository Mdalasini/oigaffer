import { AIR_DRAG, BOUNCE_FRICTION, BOUNCE_MIN_SPEED, BOUNCE_RESTITUTION, GRAVITY, ROLL_DECEL } from "./constants";
import type { Vec } from "./vec";

export interface Ball {
  pos: Vec; // on the ground plane
  z: number; // height above the grass, m
  vel: Vec; // horizontal velocity, m/s
  vz: number; // vertical velocity, m/s
}

export const restingBall = (pos: Vec): Ball => ({ pos: { ...pos }, z: 0, vel: { x: 0, y: 0 }, vz: 0 });

export const ballSpeed = (ball: Ball): number => Math.hypot(ball.vel.x, ball.vel.y);

// One step of flight or roll: gravity and drag in the air, rolling resistance and drag on the grass
export function stepBall(ball: Ball, dt: number): void {
  const airborne = ball.z > 0 || ball.vz > 0;
  if (airborne) {
    const speed = Math.hypot(ball.vel.x, ball.vel.y, ball.vz);
    const drag = Math.max(0, 1 - AIR_DRAG * speed * dt);
    ball.vel.x *= drag;
    ball.vel.y *= drag;
    ball.vz = ball.vz * drag - GRAVITY * dt;
    ball.pos.x += ball.vel.x * dt;
    ball.pos.y += ball.vel.y * dt;
    ball.z += ball.vz * dt;
    if (ball.z <= 0) {
      ball.z = 0;
      if (ball.vz < -BOUNCE_MIN_SPEED) {
        ball.vz = -ball.vz * BOUNCE_RESTITUTION;
        ball.vel.x *= BOUNCE_FRICTION;
        ball.vel.y *= BOUNCE_FRICTION;
      } else {
        ball.vz = 0;
      }
    }
    return;
  }

  const speed = Math.hypot(ball.vel.x, ball.vel.y);
  if (speed === 0) return;
  const slowed = Math.max(0, speed - (ROLL_DECEL + AIR_DRAG * speed * speed) * dt);
  const k = slowed / speed;
  ball.vel.x *= k;
  ball.vel.y *= k;
  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;
}

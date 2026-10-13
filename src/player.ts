import {
  ACCEL,
  ACCEL_AT_TOP_SPEED,
  ACCEL_PER_POINT,
  ACCEL_SIDEWAYS,
  BACKPEDAL_SPEED,
  BRAKE,
  TOP_SPEED,
  TOP_SPEED_PER_PACE,
  TURN_RATE_SPRINT,
  TURN_RATE_STILL,
} from "./constants";
import { angleDiff, angleOf, length, type Vec } from "./vec";

// 1–20, 10 is an average professional
export interface Attributes {
  pace: number;
  acceleration: number;
  firstTouch: number;
  dribbling: number;
  shooting: number;
}

export const averageAttributes = (): Attributes => ({ pace: 10, acceleration: 10, firstTouch: 10, dribbling: 10, shooting: 10 });

// What the player is trying to do this step. Movement reads `move`; the rest is
// there so a viewer can show why.
export interface Intent {
  action: string;
  move: Vec; // desired velocity, m/s
  target: Vec; // where they're heading or aiming
  note?: string;
}

export interface Player {
  id: string;
  attributes: Attributes;
  pos: Vec;
  vel: Vec;
  facing: number; // radians
  touchReadyAt: number; // time from which they can touch the ball again, s
  intent: Intent;
}

export const topSpeed = (p: Player): number => TOP_SPEED + TOP_SPEED_PER_PACE * (p.attributes.pace - 10);
export const accelOf = (p: Player): number => ACCEL + ACCEL_PER_POINT * (p.attributes.acceleration - 10);

// Fastest a player can move in a direction, given the way they face: full speed
// ahead, a shuffle sideways or backwards
export function speedLimit(p: Player, direction: number, top = topSpeed(p)): number {
  const ahead = Math.max(0, Math.cos(angleDiff(p.facing, direction)));
  return BACKPEDAL_SPEED + (top - BACKPEDAL_SPEED) * ahead;
}

export function turnRate(p: Player): number {
  const t = Math.min(1, length(p.vel) / topSpeed(p));
  return TURN_RATE_STILL + (TURN_RATE_SPRINT - TURN_RATE_STILL) * t;
}

// Moves the player towards their intended velocity like a footballer: limited
// acceleration and braking, turning at a limited rate, and slower unless they
// face where they're going.
export function steer(p: Player, dt: number): void {
  const want = p.intent.move;
  const wantSpeed = length(want);
  const wantDir = angleOf(want);

  // Face where they're going, or the target when standing
  const faceTo = wantSpeed > 0.3 ? wantDir : angleOf({ x: p.intent.target.x - p.pos.x, y: p.intent.target.y - p.pos.y });
  const turn = angleDiff(p.facing, faceTo);
  const maxTurn = turnRate(p) * dt;
  p.facing += Math.max(-maxTurn, Math.min(maxTurn, turn));

  const capped = wantSpeed === 0 ? 0 : Math.min(wantSpeed, speedLimit(p, wantDir));
  const target = wantSpeed === 0 ? { x: 0, y: 0 } : { x: (want.x / wantSpeed) * capped, y: (want.y / wantSpeed) * capped };
  const dv = { x: target.x - p.vel.x, y: target.y - p.vel.y };
  const change = length(dv);
  // Pushing off is strongest straight ahead; braking works in any direction
  const ahead = Math.max(0, Math.cos(angleDiff(p.facing, angleOf(dv))));
  const fade = Math.max(ACCEL_AT_TOP_SPEED, 1 - length(p.vel) / topSpeed(p));
  const accel = accelOf(p) * fade * (ACCEL_SIDEWAYS + (1 - ACCEL_SIDEWAYS) * ahead);
  const limit = (capped >= length(p.vel) ? accel : BRAKE) * dt;
  if (change > limit) {
    dv.x *= limit / change;
    dv.y *= limit / change;
  }
  p.vel.x += dv.x;
  p.vel.y += dv.y;
  p.pos.x += p.vel.x * dt;
  p.pos.y += p.vel.y * dt;
}

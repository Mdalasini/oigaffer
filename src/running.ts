import { ACCELERATION, ARRIVAL_DISTANCE, BRAKING, SIDEWAYS_SPEED, STANDING_SPEED, TOP_SPEED, TURN_RATE } from "./constants";

export type Body = { x: number; y: number; vx: number; vy: number; facing: number };
export type Aim = { x: number; y: number; vx: number; vy: number; arrivalFacing: number };

export const angleBetween = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export const facesAnyWay = (facing: number) => Number.isNaN(facing);

export const stoppingSpeed = (distance: number, braking: number) => Math.sqrt(2 * braking * Math.max(0, distance));

export function turnTowards(facing: number, heading: number, maxTurn: number): number {
  const turn = angleBetween(facing, heading);
  return Math.abs(turn) <= maxTurn ? heading : facing + Math.sign(turn) * maxTurn;
}

function topSpeedFacing(facing: number, heading: number): number {
  const ahead = Math.max(0, Math.cos(angleBetween(facing, heading)));
  return SIDEWAYS_SPEED + (TOP_SPEED - SIDEWAYS_SPEED) * ahead;
}

export function accelerated(vx: number, vy: number, wantX: number, wantY: number, dt: number): [vx: number, vy: number] {
  const changeX = wantX - vx;
  const changeY = wantY - vy;
  const change = Math.hypot(changeX, changeY);
  const speedingUp = Math.hypot(wantX, wantY) > Math.hypot(vx, vy);
  const limit = (speedingUp ? ACCELERATION : BRAKING) * dt;
  const share = change > limit ? limit / change : 1;
  return [vx + changeX * share, vy + changeY * share];
}

function arrive(body: Body, aim: Aim, dt: number): { body: Body; arrived: boolean } {
  const arrived = { x: aim.x, y: aim.y, vx: aim.vx, vy: aim.vy, facing: body.facing };
  if (facesAnyWay(aim.arrivalFacing)) return { body: arrived, arrived: true };
  arrived.facing = turnTowards(body.facing, aim.arrivalFacing, TURN_RATE * dt);
  return { body: arrived, arrived: arrived.facing === aim.arrivalFacing };
}

export function steer(body: Body, aim: Aim, dt: number): { body: Body; arrived: boolean } {
  const dx = aim.x - body.x;
  const dy = aim.y - body.y;
  const distance = Math.hypot(dx, dy);
  const closingSpeed = Math.hypot(body.vx - aim.vx, body.vy - aim.vy);
  if (distance < ARRIVAL_DISTANCE && closingSpeed < BRAKING * dt) return arrive(body, aim, dt);

  const distanceAfterStep = distance - closingSpeed * dt;
  const approachSpeed = Math.min(TOP_SPEED, stoppingSpeed(distanceAfterStep, BRAKING));
  const towardsX = distance > 0 ? dx / distance : 0;
  const towardsY = distance > 0 ? dy / distance : 0;
  let wantX = aim.vx + towardsX * approachSpeed;
  let wantY = aim.vy + towardsY * approachSpeed;
  const wantedSpeed = Math.hypot(wantX, wantY);
  const heading = Math.atan2(wantY, wantX);

  let facing = body.facing;
  if (wantedSpeed > STANDING_SPEED) facing = turnTowards(facing, heading, TURN_RATE * dt);
  else if (!facesAnyWay(aim.arrivalFacing)) facing = turnTowards(facing, aim.arrivalFacing, TURN_RATE * dt);

  const allowedSpeed = topSpeedFacing(facing, heading);
  if (wantedSpeed > allowedSpeed) {
    wantX *= allowedSpeed / wantedSpeed;
    wantY *= allowedSpeed / wantedSpeed;
  }
  const [vx, vy] = accelerated(body.vx, body.vy, wantX, wantY, dt);
  return { body: { ...body, vx, vy, facing }, arrived: false };
}

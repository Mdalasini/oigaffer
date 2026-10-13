import { query, removeComponent } from "bitecs";
import {
  ACCELERATION,
  ARRIVAL_DISTANCE,
  BALL_ROLLING_DECELERATION,
  BRAKING,
  DRIBBLE_BRAKING,
  DRIBBLE_DISTANCE_BEHIND_BALL,
  DRIBBLE_STOP_DISTANCE,
  MAX_DRIBBLE_TOUCH_SPEED,
  SIDEWAYS_SPEED,
  STANDING_SPEED,
  TIME_STEP,
  TOP_SPEED,
  TOUCH_INTERVAL,
  TOUCH_REACH,
  TOUCH_SPEED_ABOVE_RUNNING,
  TURN_RATE,
} from "./constants";
import { setTarget, type Game } from "./world";

const angleBetween = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

const facesAnyWay = (facing: number) => Number.isNaN(facing);

const stoppingSpeed = (distance: number, braking: number) => Math.sqrt(2 * braking * Math.max(0, distance));

function turnTowards(facing: number, heading: number, maxTurn: number): number {
  const turn = angleBetween(facing, heading);
  return Math.abs(turn) <= maxTurn ? heading : facing + Math.sign(turn) * maxTurn;
}

function topSpeedFacing(facing: number, heading: number): number {
  const ahead = Math.max(0, Math.cos(angleBetween(facing, heading)));
  return SIDEWAYS_SPEED + (TOP_SPEED - SIDEWAYS_SPEED) * ahead;
}

function arrive(world: Game, eid: number, dt: number): void {
  const { Position, Velocity, Target, Facing } = world.components;
  Position.x[eid] = Target.x[eid]!;
  Position.y[eid] = Target.y[eid]!;
  Velocity.x[eid] = Target.vx[eid]!;
  Velocity.y[eid] = Target.vy[eid]!;
  const arrivalFacing = Target.arrivalFacing[eid]!;
  if (facesAnyWay(arrivalFacing)) {
    removeComponent(world, eid, Target);
    return;
  }
  Facing[eid] = turnTowards(Facing[eid]!, arrivalFacing, TURN_RATE * dt);
  if (Facing[eid] === arrivalFacing) removeComponent(world, eid, Target);
}

function accelerateTowards(world: Game, eid: number, wantX: number, wantY: number, dt: number): void {
  const { Velocity } = world.components;
  const vx = Velocity.x[eid]!;
  const vy = Velocity.y[eid]!;
  const changeX = wantX - vx;
  const changeY = wantY - vy;
  const change = Math.hypot(changeX, changeY);
  const speedingUp = Math.hypot(wantX, wantY) > Math.hypot(vx, vy);
  const limit = (speedingUp ? ACCELERATION : BRAKING) * dt;
  const share = change > limit ? limit / change : 1;
  Velocity.x[eid] = vx + changeX * share;
  Velocity.y[eid] = vy + changeY * share;
}

export function runToTarget(world: Game, dt: number): void {
  const { Position, Velocity, Target, Facing } = world.components;
  for (const eid of query(world, [Position, Velocity, Target, Facing])) {
    const targetVx = Target.vx[eid]!;
    const targetVy = Target.vy[eid]!;
    const dx = Target.x[eid]! - Position.x[eid]!;
    const dy = Target.y[eid]! - Position.y[eid]!;
    const distance = Math.hypot(dx, dy);
    const closingSpeed = Math.hypot(Velocity.x[eid]! - targetVx, Velocity.y[eid]! - targetVy);

    if (distance < ARRIVAL_DISTANCE && closingSpeed < BRAKING * dt) {
      arrive(world, eid, dt);
      continue;
    }

    const distanceAfterStep = distance - closingSpeed * dt;
    const approachSpeed = Math.min(TOP_SPEED, stoppingSpeed(distanceAfterStep, BRAKING));
    const towardsX = distance > 0 ? dx / distance : 0;
    const towardsY = distance > 0 ? dy / distance : 0;
    let wantX = targetVx + towardsX * approachSpeed;
    let wantY = targetVy + towardsY * approachSpeed;
    const wantedSpeed = Math.hypot(wantX, wantY);
    const heading = Math.atan2(wantY, wantX);

    const arrivalFacing = Target.arrivalFacing[eid]!;
    if (wantedSpeed > STANDING_SPEED) Facing[eid] = turnTowards(Facing[eid]!, heading, TURN_RATE * dt);
    else if (!facesAnyWay(arrivalFacing)) Facing[eid] = turnTowards(Facing[eid]!, arrivalFacing, TURN_RATE * dt);

    const allowedSpeed = topSpeedFacing(Facing[eid]!, heading);
    if (wantedSpeed > allowedSpeed) {
      wantX *= allowedSpeed / wantedSpeed;
      wantY *= allowedSpeed / wantedSpeed;
    }
    accelerateTowards(world, eid, wantX, wantY, dt);
  }
}

function dribbleTouchSpeed(runningSpeed: number, distanceLeft: number): number {
  return Math.min(
    Math.max(0, runningSpeed) + TOUCH_SPEED_ABOVE_RUNNING,
    MAX_DRIBBLE_TOUCH_SPEED,
    stoppingSpeed(distanceLeft, DRIBBLE_BRAKING),
    distanceLeft / TOUCH_INTERVAL,
  );
}

export function dribble(world: Game, dt: number): void {
  const { Position, Velocity, Facing, Dribble, Ball } = world.components;
  const ball = query(world, [Ball])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Velocity, Facing, Dribble])) {
    const ballX = Position.x[ball]!;
    const ballY = Position.y[ball]!;
    const toBallX = ballX - Position.x[eid]!;
    const toBallY = ballY - Position.y[eid]!;
    const dx = Dribble.x[eid]! - ballX;
    const dy = Dribble.y[eid]! - ballY;
    const distanceLeft = Math.hypot(dx, dy);
    const onwardX = distanceLeft > 0 ? dx / distanceLeft : 0;
    const onwardY = distanceLeft > 0 ? dy / distanceLeft : 0;
    Dribble.nextTouchIn[eid] = Math.max(0, Dribble.nextTouchIn[eid]! - dt);

    const arrived = distanceLeft < DRIBBLE_STOP_DISTANCE;
    const withinReach = Math.hypot(toBallX, toBallY) <= TOUCH_REACH;
    const ready = Dribble.nextTouchIn[eid] === 0;
    const ballInFront = Math.abs(angleBetween(Facing[eid]!, Math.atan2(toBallY, toBallX))) <= Math.PI / 2;
    const ballOnTheWay = toBallX * onwardX + toBallY * onwardY >= 0;

    if (withinReach && ready && ballInFront && (ballOnTheWay || arrived)) {
      Dribble.nextTouchIn[eid] = TOUCH_INTERVAL;
      const runningSpeed = Velocity.x[eid]! * onwardX + Velocity.y[eid]! * onwardY;
      const touchSpeed = arrived ? 0 : dribbleTouchSpeed(runningSpeed, distanceLeft);
      Velocity.x[ball] = onwardX * touchSpeed;
      Velocity.y[ball] = onwardY * touchSpeed;
      if (arrived) removeComponent(world, eid, Dribble);
    }

    setTarget(
      world,
      eid,
      ballX - onwardX * DRIBBLE_DISTANCE_BEHIND_BALL,
      ballY - onwardY * DRIBBLE_DISTANCE_BEHIND_BALL,
      Velocity.x[ball]!,
      Velocity.y[ball]!,
      Math.atan2(onwardY, onwardX),
    );
  }
}

export function roll(world: Game, dt: number): void {
  const { Velocity, Ball } = world.components;
  for (const eid of query(world, [Ball, Velocity])) {
    const vx = Velocity.x[eid]!;
    const vy = Velocity.y[eid]!;
    const speed = Math.hypot(vx, vy);
    if (speed === 0) continue;
    const share = Math.max(0, speed - BALL_ROLLING_DECELERATION * dt) / speed;
    Velocity.x[eid] = vx * share;
    Velocity.y[eid] = vy * share;
  }
}

export function move(world: Game, dt: number): void {
  const { Position, Velocity } = world.components;
  for (const eid of query(world, [Position, Velocity])) {
    Position.x[eid] = Position.x[eid]! + Velocity.x[eid]! * dt;
    Position.y[eid] = Position.y[eid]! + Velocity.y[eid]! * dt;
  }
}

export function step(world: Game, dt = TIME_STEP): void {
  dribble(world, dt);
  runToTarget(world, dt);
  roll(world, dt);
  move(world, dt);
}

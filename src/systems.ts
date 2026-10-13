import { query, removeComponent } from "bitecs";
import {
  ACCEL,
  ARRIVED,
  BEHIND_BALL,
  BRAKE,
  DRIBBLE_BRAKE,
  DRIBBLE_SPEED,
  DRIBBLED,
  DT,
  MOVING,
  REACH,
  ROLL_DECEL,
  SIDEWAYS_SPEED,
  TOP_SPEED,
  TOUCH_AHEAD,
  TOUCH_INTERVAL,
  TURN_RATE,
} from "./constants";
import { setTarget, type Game } from "./world";

const angleBetween = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

function turnTowards(facing: number, heading: number, maxTurn: number): number {
  const turn = angleBetween(facing, heading);
  return Math.abs(turn) <= maxTurn ? heading : facing + Math.sign(turn) * maxTurn;
}

function speedFacing(facing: number, heading: number): number {
  const ahead = Math.max(0, Math.cos(angleBetween(facing, heading)));
  return SIDEWAYS_SPEED + (TOP_SPEED - SIDEWAYS_SPEED) * ahead;
}

// Run to the target as fast as possible and stop on it. A moving target is
// matched for speed and the gap closed, braking in time not to overshoot.
export function runToTarget(world: Game, dt: number): void {
  const { Position, Velocity, Target, Facing } = world.components;
  for (const eid of query(world, [Position, Velocity, Target, Facing])) {
    const tvx = Target.vx[eid]!;
    const tvy = Target.vy[eid]!;
    const vx = Velocity.x[eid]!;
    const vy = Velocity.y[eid]!;
    const dx = Target.x[eid]! - Position.x[eid]!;
    const dy = Target.y[eid]! - Position.y[eid]!;
    const distance = Math.hypot(dx, dy);
    const closing = Math.hypot(vx - tvx, vy - tvy);

    if (distance < ARRIVED && closing < BRAKE * dt) {
      Position.x[eid] = Target.x[eid]!;
      Position.y[eid] = Target.y[eid]!;
      Velocity.x[eid] = tvx;
      Velocity.y[eid] = tvy;
      const face = Target.face[eid]!;
      if (!Number.isNaN(face)) Facing[eid] = turnTowards(Facing[eid]!, face, TURN_RATE * dt);
      if (Number.isNaN(face) || Facing[eid] === face) removeComponent(world, eid, Target);
      continue;
    }

    // The fastest closing speed from which braking still stops on the target, measured
    // from where they'll be after this step so they don't arrive still moving
    const approach = Math.min(TOP_SPEED, Math.sqrt(2 * BRAKE * Math.max(0, distance - closing * dt)));
    const ux = distance > 0 ? dx / distance : 0;
    const uy = distance > 0 ? dy / distance : 0;
    let wantX = tvx + ux * approach;
    let wantY = tvy + uy * approach;
    let wanted = Math.hypot(wantX, wantY);
    const face = Target.face[eid]!;
    const heading = Math.atan2(wantY, wantX);
    if (wanted > MOVING || !Number.isNaN(face)) {
      Facing[eid] = turnTowards(Facing[eid]!, wanted > MOVING || Number.isNaN(face) ? heading : face, TURN_RATE * dt);
    }
    if (wanted > 0) {
      const allowed = speedFacing(Facing[eid]!, heading);
      if (wanted > allowed) {
        wantX *= allowed / wanted;
        wantY *= allowed / wanted;
        wanted = allowed;
      }
    }

    const changeX = wantX - vx;
    const changeY = wantY - vy;
    const change = Math.hypot(changeX, changeY);
    const limit = (wanted > Math.hypot(vx, vy) ? ACCEL : BRAKE) * dt;
    const k = change > limit ? limit / change : 1;
    Velocity.x[eid] = vx + changeX * k;
    Velocity.y[eid] = vy + changeY * k;
  }
}

// A dribbler runs to the ball and keeps touching it on towards where they're
// taking it, about every other stride: a little faster than they're running, but
// never faster than they could stop from in time, and never so hard that it passes
// the spot before the next touch. Close enough, they stop it dead.
export function dribble(world: Game, dt: number): void {
  const { Position, Velocity, Facing, Dribble, Ball } = world.components;
  const ball = query(world, [Ball])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Velocity, Facing, Dribble])) {
    const bx = Position.x[ball]!;
    const by = Position.y[ball]!;
    const toBallX = bx - Position.x[eid]!;
    const toBallY = by - Position.y[eid]!;
    const gap = Math.hypot(toBallX, toBallY);
    const dx = Dribble.x[eid]! - bx;
    const dy = Dribble.y[eid]! - by;
    const left = Math.hypot(dx, dy);
    const ux = left > 0 ? dx / left : 0;
    const uy = left > 0 ? dy / left : 0;
    Dribble.ready[eid] = Math.max(0, Dribble.ready[eid]! - dt);

    const inFront = Math.abs(angleBetween(Facing[eid]!, Math.atan2(toBallY, toBallX))) <= Math.PI / 2;
    const ballOnTheWay = toBallX * ux + toBallY * uy >= 0;
    if (gap <= REACH && Dribble.ready[eid] === 0 && inFront && (ballOnTheWay || left < DRIBBLED)) {
      Dribble.ready[eid] = TOUCH_INTERVAL;
      if (left < DRIBBLED) {
        Velocity.x[ball] = 0;
        Velocity.y[ball] = 0;
        removeComponent(world, eid, Dribble);
      } else {
        const running = Math.max(0, Velocity.x[eid]! * ux + Velocity.y[eid]! * uy);
        const speed = Math.min(running + TOUCH_AHEAD, DRIBBLE_SPEED, Math.sqrt(2 * DRIBBLE_BRAKE * left), left / TOUCH_INTERVAL);
        Velocity.x[ball] = ux * speed;
        Velocity.y[ball] = uy * speed;
      }
    }

    setTarget(world, eid, bx - ux * BEHIND_BALL, by - uy * BEHIND_BALL, Velocity.x[ball]!, Velocity.y[ball]!, Math.atan2(uy, ux));
  }
}

// A rolling ball slows down and stops
export function roll(world: Game, dt: number): void {
  const { Velocity, Ball } = world.components;
  for (const eid of query(world, [Ball, Velocity])) {
    const vx = Velocity.x[eid]!;
    const vy = Velocity.y[eid]!;
    const speed = Math.hypot(vx, vy);
    if (speed === 0) continue;
    const k = Math.max(0, speed - ROLL_DECEL * dt) / speed;
    Velocity.x[eid] = vx * k;
    Velocity.y[eid] = vy * k;
  }
}

export function move(world: Game, dt: number): void {
  const { Position, Velocity } = world.components;
  for (const eid of query(world, [Position, Velocity])) {
    Position.x[eid] = Position.x[eid]! + Velocity.x[eid]! * dt;
    Position.y[eid] = Position.y[eid]! + Velocity.y[eid]! * dt;
  }
}

export function step(world: Game, dt = DT): void {
  dribble(world, dt);
  runToTarget(world, dt);
  roll(world, dt);
  move(world, dt);
}

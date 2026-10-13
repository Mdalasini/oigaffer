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
  REACH,
  ROLL_DECEL,
  TOP_SPEED,
  TOUCH_AHEAD,
  TOUCH_INTERVAL,
} from "./constants";
import { setTarget, type Game } from "./world";

// Run to the target as fast as possible and stop on it. A moving target is
// matched for speed and the gap closed, braking in time not to overshoot.
export function runToTarget(world: Game, dt: number): void {
  const { Position, Velocity, Target } = world.components;
  for (const eid of query(world, [Position, Velocity, Target])) {
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
      removeComponent(world, eid, Target);
      continue;
    }

    // The fastest closing speed from which braking still stops on the target, measured
    // from where they'll be after this step so they don't arrive still moving
    const approach = Math.min(TOP_SPEED, Math.sqrt(2 * BRAKE * Math.max(0, distance - closing * dt)));
    const ux = distance > 0 ? dx / distance : 0;
    const uy = distance > 0 ? dy / distance : 0;
    let wantX = tvx + ux * approach;
    let wantY = tvy + uy * approach;
    const wanted = Math.hypot(wantX, wantY);
    if (wanted > TOP_SPEED) {
      wantX *= TOP_SPEED / wanted;
      wantY *= TOP_SPEED / wanted;
    }

    const changeX = wantX - vx;
    const changeY = wantY - vy;
    const change = Math.hypot(changeX, changeY);
    const limit = (Math.min(wanted, TOP_SPEED) > Math.hypot(vx, vy) ? ACCEL : BRAKE) * dt;
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
  const { Position, Velocity, Dribble, Ball } = world.components;
  const ball = query(world, [Ball])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Velocity, Dribble])) {
    const bx = Position.x[ball]!;
    const by = Position.y[ball]!;
    const toBallX = bx - Position.x[eid]!;
    const toBallY = by - Position.y[eid]!;
    const gap = Math.hypot(toBallX, toBallY);
    Dribble.ready[eid] = Math.max(0, Dribble.ready[eid]! - dt);

    if (gap <= REACH && Dribble.ready[eid] === 0) {
      Dribble.ready[eid] = TOUCH_INTERVAL;
      const dx = Dribble.x[eid]! - bx;
      const dy = Dribble.y[eid]! - by;
      const left = Math.hypot(dx, dy);
      if (left < DRIBBLED) {
        Velocity.x[ball] = 0;
        Velocity.y[ball] = 0;
        removeComponent(world, eid, Dribble);
      } else {
        const ux = dx / left;
        const uy = dy / left;
        const running = Math.max(0, Velocity.x[eid]! * ux + Velocity.y[eid]! * uy);
        const speed = Math.min(running + TOUCH_AHEAD, DRIBBLE_SPEED, Math.sqrt(2 * DRIBBLE_BRAKE * left), left / TOUCH_INTERVAL);
        Velocity.x[ball] = ux * speed;
        Velocity.y[ball] = uy * speed;
      }
    }

    // Chase a spot just behind the ball, on their side of it, moving with it
    const back = gap > 0 ? BEHIND_BALL / gap : 0;
    setTarget(world, eid, bx - toBallX * back, by - toBallY * back, Velocity.x[ball]!, Velocity.y[ball]!);
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

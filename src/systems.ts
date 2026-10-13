import { query, removeComponent } from "bitecs";
import { ACCEL, ARRIVED, BRAKE, DT, TOP_SPEED } from "./constants";
import type { Game } from "./world";

// Run towards the target as fast as possible, braking in time to stop on it
export function runToTarget(world: Game, dt: number): void {
  const { Position, Velocity, Target } = world.components;
  for (const eid of query(world, [Position, Velocity, Target])) {
    const tx = Target.x[eid]!;
    const ty = Target.y[eid]!;
    const vx = Velocity.x[eid]!;
    const vy = Velocity.y[eid]!;
    const dx = tx - Position.x[eid]!;
    const dy = ty - Position.y[eid]!;
    const distance = Math.hypot(dx, dy);
    const speed = Math.hypot(vx, vy);

    if (distance < ARRIVED && speed < BRAKE * dt) {
      Position.x[eid] = tx;
      Position.y[eid] = ty;
      Velocity.x[eid] = 0;
      Velocity.y[eid] = 0;
      removeComponent(world, eid, Target);
      continue;
    }

    // The fastest speed from which braking still stops on the target, measured from
    // where they'll be after this step so they don't arrive still moving
    const wanted = Math.min(TOP_SPEED, Math.sqrt(2 * BRAKE * Math.max(0, distance - speed * dt)));
    const changeX = (dx / distance) * wanted - vx;
    const changeY = (dy / distance) * wanted - vy;
    const change = Math.hypot(changeX, changeY);
    const limit = (wanted > speed ? ACCEL : BRAKE) * dt;
    const k = change > limit ? limit / change : 1;
    Velocity.x[eid] = vx + changeX * k;
    Velocity.y[eid] = vy + changeY * k;
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
  runToTarget(world, dt);
  move(world, dt);
}

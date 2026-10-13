import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import { ACCEL, BRAKE, DT, TOP_SPEED } from "./constants";
import { step } from "./systems";
import { addPlayer, createGame, setTarget } from "./world";

// Runs a player from one point to another, recording speed every step
function run(from: [number, number], to: [number, number]) {
  const world = createGame();
  const { Position, Velocity, Target } = world.components;
  const eid = addPlayer(world, ...from);
  setTarget(world, eid, ...to);
  const speeds = [0];
  let time = 0;
  while (hasComponent(world, eid, Target) && time < 60) {
    step(world);
    time += DT;
    speeds.push(Math.hypot(Velocity.x[eid]!, Velocity.y[eid]!));
  }
  return { time, speeds, x: Position.x[eid]!, y: Position.y[eid]! };
}

describe("a player running from one point to another", () => {
  test("never overshoots the target", () => {
    const world = createGame();
    const { Position, Target } = world.components;
    const eid = addPlayer(world, 20, 34);
    setTarget(world, eid, 50, 34);
    while (hasComponent(world, eid, Target)) {
      step(world);
      expect(Position.x[eid]!).toBeLessThanOrEqual(50);
    }
  });

  test("arrives and stops exactly on the target", () => {
    const { x, y, speeds } = run([10, 10], [40, 50]);
    expect(x).toBe(40);
    expect(y).toBe(50);
    expect(speeds.at(-1)).toBe(0);
  });

  test("never runs faster than top speed", () => {
    const { speeds } = run([0, 34], [105, 34]);
    expect(Math.max(...speeds)).toBeCloseTo(TOP_SPEED, 5);
  });

  test("speeds up and slows down no faster than a player can", () => {
    const { speeds } = run([0, 34], [60, 34]);
    for (let i = 1; i < speeds.length; i++) {
      const change = (speeds[i]! - speeds[i - 1]!) / DT;
      expect(change).toBeLessThanOrEqual(ACCEL + 1e-6);
      expect(change).toBeGreaterThanOrEqual(-BRAKE - 1e-6);
    }
  });

  test("30 m from standing to standing takes about five seconds", () => {
    // 2 s up to top speed, about 2 s at it, 1.3 s braking
    const { time } = run([20, 34], [50, 34]);
    expect(time).toBeGreaterThan(5);
    expect(time).toBeLessThan(6);
  });

  test("a short run never reaches top speed", () => {
    // Accelerating then braking over 4 m peaks at about 4.4 m/s
    const { speeds } = run([20, 34], [24, 34]);
    expect(Math.max(...speeds)).toBeGreaterThan(4);
    expect(Math.max(...speeds)).toBeLessThan(5);
  });
});

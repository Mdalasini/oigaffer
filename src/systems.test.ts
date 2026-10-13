import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import { ACCELERATION, BRAKING, TIME_STEP, SIDEWAYS_SPEED, TOP_SPEED } from "./constants";
import { step } from "./systems";
import { addPlayer, createGame, setTarget } from "./world";

function runFromTo(from: [number, number], to: [number, number]) {
  const world = createGame();
  const { Position, Velocity, Target } = world.components;
  const eid = addPlayer(world, ...from);
  setTarget(world, eid, ...to);
  const speeds = [0];
  let time = 0;
  while (hasComponent(world, eid, Target) && time < 60) {
    step(world);
    time += TIME_STEP;
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
    const { x, y, speeds } = runFromTo([10, 10], [40, 50]);
    expect(x).toBe(40);
    expect(y).toBe(50);
    expect(speeds.at(-1)).toBe(0);
  });

  test("never runs faster than top speed", () => {
    const { speeds } = runFromTo([0, 34], [105, 34]);
    expect(Math.max(...speeds)).toBeCloseTo(TOP_SPEED, 5);
  });

  test("speeds up and slows down no faster than a player can", () => {
    const { speeds } = runFromTo([0, 34], [60, 34]);
    for (let i = 1; i < speeds.length; i++) {
      const change = (speeds[i]! - speeds[i - 1]!) / TIME_STEP;
      expect(change).toBeLessThanOrEqual(ACCELERATION + 1e-6);
      expect(change).toBeGreaterThanOrEqual(-BRAKING - 1e-6);
    }
  });

  test("30 m from standing to standing takes between five and six seconds", () => {
    const { time } = runFromTo([20, 34], [50, 34]);
    expect(time).toBeGreaterThan(5);
    expect(time).toBeLessThan(6);
  });

  test("a 4 m run peaks between 4 and 5 m/s, well short of top speed", () => {
    const { speeds } = runFromTo([20, 34], [24, 34]);
    expect(Math.max(...speeds)).toBeGreaterThan(4);
    expect(Math.max(...speeds)).toBeLessThan(5);
  });

  test("turns to face where they're going, half a turn in about half a second", () => {
    const world = createGame();
    const { Facing } = world.components;
    const eid = addPlayer(world, 50, 34, Math.PI);
    setTarget(world, eid, 80, 34);
    for (let t = 0; t < 0.3; t += TIME_STEP) step(world);
    expect(Math.cos(Facing[eid]!)).toBeLessThan(0.5);
    for (let t = 0; t < 0.3; t += TIME_STEP) step(world);
    expect(Math.cos(Facing[eid]!)).toBeCloseTo(1, 5);
  });

  test("moves slowly until they've turned to face the way they're going", () => {
    const world = createGame();
    const { Facing, Velocity } = world.components;
    const eid = addPlayer(world, 50, 34, Math.PI);
    setTarget(world, eid, 80, 34);
    while (Math.cos(Facing[eid]!) < 0) {
      step(world);
      expect(Math.hypot(Velocity.x[eid]!, Velocity.y[eid]!)).toBeLessThanOrEqual(SIDEWAYS_SPEED + 1e-9);
    }
  });
});

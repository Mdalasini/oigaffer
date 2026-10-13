import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import { MAX_DRIBBLE_TOUCH_SPEED, DRIBBLE_STOP_DISTANCE, TIME_STEP, TOUCH_REACH, BALL_ROLLING_DECELERATION } from "./constants";
import { step } from "./systems";
import { addBall, addPlayer, createGame, setDribble } from "./world";

function dribbleFromTo(player: [number, number], ball: [number, number], to: [number, number], changeOfMind?: { after: number; to: [number, number] }) {
  const world = createGame();
  const { Position, Velocity, Dribble, Target, Facing } = world.components;
  const p = addPlayer(world, ...player);
  const b = addBall(world, ...ball);
  setDribble(world, p, ...to);
  const gaps: number[] = [];
  const ballSpeeds: number[] = [];
  const facingAtTouches: number[] = [];
  let time = 0;
  while ((hasComponent(world, p, Dribble) || hasComponent(world, p, Target)) && time < 30) {
    if (changeOfMind && Math.abs(time - changeOfMind.after) < TIME_STEP / 2) setDribble(world, p, ...changeOfMind.to);
    step(world);
    time += TIME_STEP;
    gaps.push(Math.hypot(Position.x[b]! - Position.x[p]!, Position.y[b]! - Position.y[p]!));
    const ballSpeed = Math.hypot(Velocity.x[b]!, Velocity.y[b]!);
    if (ballSpeed > (ballSpeeds.at(-1) ?? 0)) facingAtTouches.push(Facing[p]!);
    ballSpeeds.push(ballSpeed);
  }
  const finalTo = changeOfMind?.to ?? to;
  const ballTo = Math.hypot(Position.x[b]! - finalTo[0], Position.y[b]! - finalTo[1]);
  return { time, gaps, ballSpeeds, facingAtTouches, ballTo, ballStill: ballSpeeds.at(-1) === 0, finalGap: gaps.at(-1)! };
}

describe("a ball rolling on its own", () => {
  test("slows at a steady rate and stops", () => {
    const world = createGame();
    const { Position, Velocity } = world.components;
    const b = addBall(world, 0, 0);
    Velocity.x[b] = 4;
    let time = 0;
    while (Velocity.x[b]! > 0) {
      step(world);
      time += TIME_STEP;
    }
    expect(time).toBeCloseTo(4 / BALL_ROLLING_DECELERATION, 1);
    expect(Position.x[b]!).toBeCloseTo((4 * 4) / (2 * BALL_ROLLING_DECELERATION), 0);
  });
});

describe("a player running with the ball", () => {
  test("takes it to the spot and stops it there, with the ball at their feet", () => {
    const run = dribbleFromTo([20, 34], [20.3, 34], [50, 34]);
    expect(run.ballTo).toBeLessThan(DRIBBLE_STOP_DISTANCE);
    expect(run.ballStill).toBe(true);
    expect(run.finalGap).toBeLessThanOrEqual(TOUCH_REACH);
  });

  test("keeps the ball close all the way", () => {
    const run = dribbleFromTo([20, 34], [20.3, 34], [80, 34]);
    expect(Math.max(...run.gaps)).toBeLessThan(TOUCH_REACH + 0.2);
  });

  test("takes 30 m a little slower than the 5.45 s it takes without the ball", () => {
    const { time, ballSpeeds } = dribbleFromTo([20, 34], [20.3, 34], [50, 34]);
    expect(time).toBeGreaterThan(5.5);
    expect(time).toBeLessThan(7.5);
    expect(Math.max(...ballSpeeds)).toBeLessThanOrEqual(MAX_DRIBBLE_TOUCH_SPEED + 1e-9);
  });

  test("turns round with the ball to take it back the way they came", () => {
    const run = dribbleFromTo([50, 34], [50.3, 34], [30, 34]);
    expect(run.ballTo).toBeLessThan(DRIBBLE_STOP_DISTANCE);
    expect(run.finalGap).toBeLessThanOrEqual(TOUCH_REACH);
    expect(run.facingAtTouches.length).toBeGreaterThan(3);
    for (const facing of run.facingAtTouches) expect(Math.cos(facing - Math.PI)).toBeGreaterThan(0);
  });

  test("goes and gets a ball that isn't at their feet first", () => {
    const run = dribbleFromTo([20, 34], [25, 30], [50, 34]);
    expect(run.ballTo).toBeLessThan(DRIBBLE_STOP_DISTANCE);
    expect(run.finalGap).toBeLessThanOrEqual(TOUCH_REACH);
  });

  test.each([
    ["back the way they came", [20, 34]],
    ["off to the side", [45, 60]],
    ["back over their shoulder", [30, 60]],
  ] as const)("keeps the ball close when they change their mind mid-run and go %s", (_, to) => {
    const run = dribbleFromTo([20, 34], [20.3, 34], [90, 34], { after: 3, to: [...to] });
    expect(Math.max(...run.gaps)).toBeLessThan(TOUCH_REACH + 0.2);
    expect(run.ballTo).toBeLessThan(DRIBBLE_STOP_DISTANCE);
    expect(run.finalGap).toBeLessThanOrEqual(TOUCH_REACH);
  });
});

import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import { DRIBBLE_SPEED, DRIBBLED, DT, REACH, ROLL_DECEL } from "./constants";
import { step } from "./systems";
import { addBall, addPlayer, createGame, setDribble } from "./world";

// A player takes the ball from one point to another; records the gap between them
function dribble(player: [number, number], ball: [number, number], to: [number, number]) {
  const world = createGame();
  const { Position, Velocity, Dribble, Target } = world.components;
  const p = addPlayer(world, ...player);
  const b = addBall(world, ...ball);
  setDribble(world, p, ...to);
  const gaps: number[] = [];
  const ballSpeeds: number[] = [];
  let time = 0;
  while ((hasComponent(world, p, Dribble) || hasComponent(world, p, Target)) && time < 30) {
    step(world);
    time += DT;
    gaps.push(Math.hypot(Position.x[b]! - Position.x[p]!, Position.y[b]! - Position.y[p]!));
    ballSpeeds.push(Math.hypot(Velocity.x[b]!, Velocity.y[b]!));
  }
  const ballTo = Math.hypot(Position.x[b]! - to[0], Position.y[b]! - to[1]);
  return { time, gaps, ballSpeeds, ballTo, ballStill: ballSpeeds.at(-1) === 0, finalGap: gaps.at(-1)! };
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
      time += DT;
    }
    expect(time).toBeCloseTo(4 / ROLL_DECEL, 1);
    expect(Position.x[b]!).toBeCloseTo((4 * 4) / (2 * ROLL_DECEL), 0);
  });
});

describe("a player running with the ball", () => {
  test("takes it to the spot and stops it there, with the ball at their feet", () => {
    const run = dribble([20, 34], [20.3, 34], [50, 34]);
    expect(run.ballTo).toBeLessThan(DRIBBLED);
    expect(run.ballStill).toBe(true);
    expect(run.finalGap).toBeLessThanOrEqual(REACH);
  });

  test("keeps the ball close all the way", () => {
    const run = dribble([20, 34], [20.3, 34], [80, 34]);
    expect(Math.max(...run.gaps)).toBeLessThan(REACH + 0.2);
  });

  test("is slower with the ball than without it, but not by much", () => {
    // 30 m without the ball takes 5.45 s
    const { time, ballSpeeds } = dribble([20, 34], [20.3, 34], [50, 34]);
    expect(time).toBeGreaterThan(5.5);
    expect(time).toBeLessThan(7.5);
    expect(Math.max(...ballSpeeds)).toBeLessThanOrEqual(DRIBBLE_SPEED + 1e-9);
  });

  test("can take the ball back the way they came", () => {
    const run = dribble([50, 34], [50.3, 34], [30, 34]);
    expect(run.ballTo).toBeLessThan(DRIBBLED);
    expect(run.finalGap).toBeLessThanOrEqual(REACH);
  });

  test("goes and gets a ball that isn't at their feet first", () => {
    const run = dribble([20, 34], [25, 30], [50, 34]);
    expect(run.ballTo).toBeLessThan(DRIBBLED);
    expect(run.finalGap).toBeLessThanOrEqual(REACH);
  });
});

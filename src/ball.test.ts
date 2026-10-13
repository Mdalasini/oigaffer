import { describe, expect, test } from "bun:test";
import { restingBall, stepBall, type Ball } from "./ball";
import { DT } from "./constants";

function rollOut(ball: Ball, seconds = 30): { travelled: number; time: number; maxZ: number } {
  const start = { ...ball.pos };
  let time = 0;
  let maxZ = ball.z;
  while (time < seconds && (Math.hypot(ball.vel.x, ball.vel.y) > 0 || ball.z > 0)) {
    stepBall(ball, DT);
    time += DT;
    maxZ = Math.max(maxZ, ball.z);
  }
  return { travelled: Math.hypot(ball.pos.x - start.x, ball.pos.y - start.y), time, maxZ };
}

describe("ball", () => {
  test("a resting ball stays put", () => {
    const ball = restingBall({ x: 10, y: 10 });
    stepBall(ball, DT);
    expect(ball.pos).toEqual({ x: 10, y: 10 });
  });

  test("a firm ground pass rolls a realistic distance and stops", () => {
    // About 10 m/s is a firm 20–30 m pass
    const ball = { ...restingBall({ x: 0, y: 0 }), vel: { x: 10, y: 0 } };
    const { travelled, time } = rollOut(ball);
    expect(travelled).toBeGreaterThan(25);
    expect(travelled).toBeLessThan(40);
    expect(time).toBeLessThan(15);
    expect(ball.vel).toEqual({ x: 0, y: 0 });
  });

  test("a gentle touch only rolls a couple of metres", () => {
    const ball = { ...restingBall({ x: 0, y: 0 }), vel: { x: 2, y: 0 } };
    const { travelled } = rollOut(ball);
    expect(travelled).toBeGreaterThan(1.5);
    expect(travelled).toBeLessThan(4);
  });

  test("a lofted ball rises, bounces lower each time, and settles into a roll", () => {
    const ball = { ...restingBall({ x: 0, y: 0 }), vel: { x: 15, y: 0 }, vz: 10 };
    const { maxZ, travelled } = rollOut(ball);
    // Without drag the peak would be 10² / (2 × 9.81) ≈ 5.1 m
    expect(maxZ).toBeGreaterThan(4);
    expect(maxZ).toBeLessThan(5.1);
    expect(travelled).toBeGreaterThan(30);
    expect(ball.z).toBe(0);
    expect(ball.vz).toBe(0);
  });
});

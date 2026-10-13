import { describe, expect, test } from "bun:test";
import { DT } from "./constants";
import { averageAttributes, steer, topSpeed, type Player } from "./player";
import { length, vec } from "./vec";

function standing(facing = 0): Player {
  return {
    id: "p",
    attributes: averageAttributes(),
    pos: vec(50, 34),
    vel: vec(0, 0),
    facing,
    touchReadyAt: 0,
    intent: { action: "test", move: vec(0, 0), target: vec(50, 34) },
  };
}

function run(p: Player, seconds: number) {
  for (let t = 0; t < seconds - 1e-9; t += DT) steer(p, DT);
}

describe("player movement", () => {
  test("a sprint from standing bursts away and covers 30 m in 4–5 s", () => {
    const p = standing();
    p.intent.move = vec(topSpeed(p), 0);
    run(p, 1);
    expect(length(p.vel)).toBeGreaterThan(0.5 * topSpeed(p));
    let time = 1;
    while (p.pos.x < 80) {
      steer(p, DT);
      time += DT;
    }
    expect(time).toBeGreaterThan(4);
    expect(time).toBeLessThan(5);
  });

  test("a player facing away has to turn before sprinting", () => {
    const ahead = standing(0);
    const behind = standing(Math.PI);
    ahead.intent.move = behind.intent.move = vec(topSpeed(ahead), 0);
    run(ahead, 1);
    run(behind, 1);
    expect(behind.pos.x - 50).toBeLessThan(ahead.pos.x - 50);
    expect(Math.abs(Math.cos(behind.facing) - 1)).toBeLessThan(0.01); // turned round within the second
  });

  test("a sprinter can't reverse on the spot", () => {
    const p = standing(0);
    p.vel = vec(topSpeed(p), 0);
    p.intent.move = vec(-topSpeed(p), 0);
    run(p, 0.5);
    expect(p.vel.x).toBeGreaterThan(0); // still carrying forward momentum
  });

  test("a player who wants to stop does, quicker than they started", () => {
    const p = standing(0);
    p.vel = vec(topSpeed(p), 0);
    run(p, 1.5); // about 1.4 s from top speed
    expect(length(p.vel)).toBe(0);
  });
});

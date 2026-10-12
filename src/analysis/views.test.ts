import { expect, test } from "bun:test";
import type { Frame, Strike } from "./record";
import { averagePosition, grid, passing, running } from "./views";

const frame = (x: number, y: number, speed: number, tick = 0): Frame => ({
  id: "a", side: "home", tick, clock: tick, pos: { x, y }, slot: { x, y: 34 }, speed,
  role: "DEF", phase: "attack", dead: false, onBall: false,
});

test("zone grids give the share of points per zone", () => {
  const g = grid([{ x: 1, y: 1 }, { x: 104, y: 67 }, { x: 104, y: 60 }, { x: 50, y: 34 }], 3, 2);
  expect(g.cells).toEqual([0.25, 0, 0, 0, 0.25, 0.5]);
});

test("average position and running", () => {
  const frames = [frame(10, 34, 2, 0), frame(20, 54, 8, 1), frame(20, 54, 8, 2), frame(20, 54, 1, 3)];
  expect(averagePosition(frames)).toMatchObject({ seconds: 4, x: 17.5, width: 15, fromSlot: 15 });
  const run = running(frames);
  expect(run.per90).toBeCloseTo(19 * 1350);
  expect(run.sprintsPer90).toBeCloseTo(1350);
});

test("passing counts direction, length and how often the ball was kept", () => {
  const strike = (to: number, kept: boolean | null): Strike => ({
    id: "a", side: "home", tick: 0, flight: "pass", type: "pass", receiverId: "b", outcome: null,
    from: { x: 30, y: 34 }, to: { x: to, y: 34 }, kept,
  });
  const p = passing([strike(50, true), strike(35, false), strike(20, true), strike(40, null)]);
  expect(p).toMatchObject({ attempts: 4, kept: 2 / 3, forward: 0.75, progressive: 0.5, length: 11.25 });
});

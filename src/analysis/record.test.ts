import { expect, test } from "bun:test";
import { simulateEventMatch } from "../engine/match";
import { seededRng } from "../random";
import { strongVsWeak } from "../test-helpers";
import { recordMatch } from "./record";

const world = strongVsWeak(12, 12);
const home = world.clubs.strong!;
const away = world.clubs.weak!;

test("recording a match doesn't change it", () => {
  const rec = recordMatch(world, home, away, seededRng(3));
  expect(rec.events).toEqual(simulateEventMatch(world, home, away, seededRng(3)).events);
});

test("records every player each second, touches and strikes", () => {
  const rec = recordMatch(world, home, away, seededRng(4));
  const ticks = new Set(rec.frames.map((f) => f.tick));
  expect(ticks.size).toBeGreaterThan(5400);
  expect(rec.frames.length).toBeGreaterThan(ticks.size * 20);

  // Team frame: both keepers stay near their own goal line
  const keepers = rec.frames.filter((f) => f.role === "GK");
  expect(keepers.reduce((s, f) => s + f.pos.x, 0) / keepers.length).toBeLessThan(15);

  // Every shot event comes from a recorded strike
  const shots = rec.events.filter((e) => e.type === "shot").length;
  expect(rec.strikes.filter((s) => s.type === "shot").length).toBe(shots);
  // Nearly every strike is answered by someone gaining control
  expect(rec.strikes.filter((s) => s.kept === null).length).toBeLessThan(3);
  expect(rec.touches.length).toBeGreaterThan(rec.strikes.length * 0.8);
});

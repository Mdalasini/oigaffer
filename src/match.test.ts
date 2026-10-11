import { expect, test } from "bun:test";
import { expectedGoals, simulateMatch } from "./match";
import { samplePoisson, seededRng } from "./random";
import { strongVsWeak as world } from "./test-helpers";

test("evenly matched sides get the base xG", () => {
  expect(expectedGoals(12, 12)).toBeCloseTo(1.35);
});

test("better attack against worse defence raises xG", () => {
  expect(expectedGoals(16, 8)).toBeGreaterThan(expectedGoals(8, 16));
});

test("poisson samples average to lambda", () => {
  const rng = seededRng(1);
  const n = 20_000;
  let total = 0;
  for (let i = 0; i < n; i++) total += samplePoisson(1.8, rng);
  expect(total / n).toBeCloseTo(1.8, 1);
});

test("same seed gives the same result", () => {
  const w = world();
  const a = simulateMatch(w, w.clubs.strong!, w.clubs.weak!, seededRng(42));
  const b = simulateMatch(w, w.clubs.strong!, w.clubs.weak!, seededRng(42));
  expect(a).toEqual(b);
});

test("stronger club wins more often than it loses", () => {
  const w = world();
  const rng = seededRng(7);
  let wins = 0;
  let losses = 0;
  for (let i = 0; i < 2_000; i++) {
    const r = simulateMatch(w, w.clubs.strong!, w.clubs.weak!, rng);
    if (r.homeGoals > r.awayGoals) wins++;
    else if (r.homeGoals < r.awayGoals) losses++;
  }
  expect(wins).toBeGreaterThan(losses * 3);
});

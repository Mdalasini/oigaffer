import { expect, test } from "bun:test";
import { fixedManager } from "../manager";
import type { Mentality } from "../tactics";
import { SLOW_TEST, strongVsWeak } from "../test-helpers";
import { compare } from "./compare";
import { recordMatch } from "./record";
import { averagePosition } from "./views";

const world = strongVsWeak(12, 12);
const play = (mentality: Mentality) => (rng: () => number) =>
  recordMatch(world, world.clubs.strong!, world.clubs.weak!, rng, { home: fixedManager({ formation: "4-4-2", mentality }) });

test("compare picks up a known tactical change: attacking teams spread wider in possession", () => {
  const [width] = compare({
    count: 4,
    seed: 1,
    control: play(-2),
    treatment: play(2),
    measure: (rec) => ({
      width: averagePosition(rec.frames.filter((f) => f.side === "home" && f.role !== "GK" && f.phase === "attack" && !f.dead)).width,
    }),
  });
  expect(width!.diff).toBeGreaterThan(3);
  expect(width!.z).toBeGreaterThan(3);
}, SLOW_TEST);

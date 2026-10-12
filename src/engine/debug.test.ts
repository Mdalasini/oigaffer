import { expect, test } from "bun:test";
import { seededRng } from "../random";
import { strongVsWeak } from "../test-helpers";
import type { Intent } from "./debug";
import { isFullTime, simulateEventMatch, startEventMatch, stepEventMatch } from "./match";

test("debug hooks see every intent and decision without changing the match", () => {
  const world = strongVsWeak(12, 12);
  const home = world.clubs.strong!;
  const away = world.clubs.weak!;
  const state = startEventMatch(world, home, away, seededRng(8));
  const intents = new Map<Intent, number>();
  let decisions = 0;
  state.debug = {
    intent: (_, __, intent) => intents.set(intent, (intents.get(intent) ?? 0) + 1),
    decision: (_, __, options, probabilities, chosen) => {
      decisions++;
      expect(probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
      expect(options[chosen]).toBeDefined();
    },
  };
  while (!isFullTime(state)) stepEventMatch(state);

  expect(state.events).toEqual(simulateEventMatch(world, home, away, seededRng(8)).events);
  expect(decisions).toBeGreaterThan(300);
  for (const intent of ["shape", "press", "mark", "receive", "keeper", "look_up"] as Intent[]) {
    expect(intents.get(intent) ?? 0).toBeGreaterThan(0);
  }
});

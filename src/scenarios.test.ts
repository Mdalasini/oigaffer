import { describe, expect, test } from "bun:test";
import { GOAL_CENTRE } from "./pitch";
import { SCENARIOS } from "./scenarios";
import { play } from "./sim";
import { angleDiff, angleOf, dist, length, sub } from "./vec";
import type { World } from "./world";

const SEEDS = 100;

function runs(name: string): World[] {
  const scenario = SCENARIOS.find((s) => s.name === name);
  if (!scenario) throw new Error(`no scenario ${name}`);
  return Array.from({ length: SEEDS }, (_, seed) => play(scenario.setup(seed)));
}

const share = (worlds: World[], ok: (w: World) => boolean) => worlds.filter(ok).length / worlds.length;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const scored = (w: World) => w.result?.kind === "goal";
// Usually a shot; very rarely a ball sitting on the line is nudged over
const finishDistance = (w: World) => dist(w.touches.at(-1)!.at, GOAL_CENTRE);

describe("one player, one ball, an empty goal", () => {
  test("the same seed replays the same touches", () => {
    const scenario = SCENARIOS[0]!;
    expect(play(scenario.setup(7)).touches).toEqual(play(scenario.setup(7)).touches);
  });

  test("the ball only leaves the pitch from a shot, never from a touch", () => {
    for (const scenario of SCENARIOS) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const w = play(scenario.setup(seed));
        if (w.result?.kind === "out") expect(w.touches.at(-1)?.kind).toBe("shot");
      }
    }
  });

  test("carrying from halfway: runs at goal and scores from a sensible range", () => {
    const worlds = runs("Carry from halfway");
    expect(share(worlds, scored)).toBeGreaterThan(0.9);
    const times = worlds.filter(scored).map((w) => w.result!.time);
    expect(median(times)).toBeGreaterThan(6); // about 50 m at carrying speed
    expect(median(times)).toBeLessThan(12);
    const range = median(worlds.filter(scored).map(finishDistance));
    expect(range).toBeGreaterThan(6);
    expect(range).toBeLessThan(18);
  });

  test("a still ball is run onto and taken in stride, not 'controlled'", () => {
    const worlds = runs("Go to a still ball");
    for (const w of worlds) {
      expect(w.touches[0]!.kind).toBe("dribble");
      expect(w.touches[0]!.time).toBeLessThan(4); // about 15 m away
    }
    expect(share(worlds, scored)).toBeGreaterThan(0.9);
  });

  test("with their back to goal, a player turns with angled touches before going", () => {
    const worlds = runs("Facing own goal");
    for (const w of worlds) {
      const first = w.touches[0]!;
      const towardsGoal = angleOf(sub(GOAL_CENTRE, first.at));
      expect(Math.abs(angleDiff(angleOf(first.ballVel), towardsGoal))).toBeGreaterThan(Math.PI / 4);
    }
    expect(share(worlds, scored)).toBeGreaterThan(0.85);
    expect(median(worlds.filter(scored).map((w) => w.result!.time))).toBeLessThan(7);
  });

  test("a firm pass is controlled, taking most of the pace off it", () => {
    const worlds = runs("Pass from the side");
    for (const w of worlds) expect(w.touches[0]!.kind).toBe("control");
    expect(share(worlds, (w) => length(w.touches[0]!.ballVel) < 5)).toBeGreaterThan(0.8);
    expect(share(worlds, scored)).toBeGreaterThan(0.9);
  });

  test("from wide by the byline, a player works the ball in and finishes", () => {
    expect(share(runs("Wide by the byline"), scored)).toBeGreaterThan(0.9);
  });
});

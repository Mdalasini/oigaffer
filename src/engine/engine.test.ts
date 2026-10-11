import { describe, expect, test } from "bun:test";
import { seededRng } from "../random";
import { strongVsWeak } from "../test-helpers";
import { MATCH_SECONDS } from "./constants";
import { scoreOptions } from "./decide";
import { assignSlots } from "./formation";
import { distToSegment, moveTowards, PITCH_LENGTH, PITCH_WIDTH } from "./geometry";
import { createMatchState, simulateEventMatch } from "./match";
import { giveBall, type MatchState } from "./state";
import { assessPass, baseXg, looseBallWinChance } from "./valuation";

const world = strongVsWeak();
const newState = (): MatchState => createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(1));

// Moves everyone far out of the way so a test can stage a specific situation
function clearPitch(state: MatchState) {
  for (const p of state.players) p.pos = { x: p.side === "home" ? 1 : 104, y: p.side === "home" ? 1 : 67 };
}

describe("geometry", () => {
  test("distance to a segment uses the closest point on it", () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distToSegment({ x: 14, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });

  test("moveTowards caps the step and respects the stand-off", () => {
    expect(moveTowards({ x: 0, y: 0 }, { x: 10, y: 0 }, 4)).toEqual({ x: 4, y: 0 });
    expect(moveTowards({ x: 0, y: 0 }, { x: 3, y: 0 }, 4)).toEqual({ x: 3, y: 0 });
    expect(moveTowards({ x: 0, y: 0 }, { x: 3, y: 0 }, 4, 1)).toEqual({ x: 2, y: 0 });
  });
});

test("4-4-2 slots spread each line across the pitch", () => {
  const slots = assignSlots(["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD"]);
  expect(slots[0]).toEqual({ x: 4, y: PITCH_WIDTH / 2 });
  expect(slots.slice(1, 5).map((s) => s.y)).toEqual([1, 2, 3, 4].map((i) => (PITCH_WIDTH * i) / 5));
  expect(slots.slice(9).map((s) => s.y)).toEqual([PITCH_WIDTH / 3, (2 * PITCH_WIDTH) / 3]);
});

describe("valuation", () => {
  test("chances get worse further out and at tighter angles", () => {
    const goalY = PITCH_WIDTH / 2;
    expect(baseXg("home", { x: 94, y: goalY })).toBeGreaterThan(baseXg("home", { x: 80, y: goalY }));
    expect(baseXg("home", { x: 94, y: goalY })).toBeGreaterThan(baseXg("home", { x: 102, y: goalY - 11 }));
    // The away side attacks the other goal
    expect(baseXg("away", { x: 11, y: goalY })).toBeCloseTo(baseXg("home", { x: 94, y: goalY }));
  });

  test("an opponent in the passing lane makes a pass riskier", () => {
    const state = newState();
    clearPitch(state);
    const [passer, receiver] = state.players.filter((p) => p.side === "home" && p.position === "MID");
    const defender = state.players.find((p) => p.side === "away" && p.position === "DEF")!;
    passer!.pos = { x: 40, y: 34 };
    receiver!.pos = { x: 60, y: 34 };

    const open = assessPass(state, passer!, receiver!).success;
    defender.pos = { x: 50, y: 34 };
    const blocked = assessPass(state, passer!, receiver!);
    expect(blocked.success).toBeLessThan(open);
    expect(blocked.risks.map((r) => r.player.id)).toContain(defender.id);
  });

  test("the side with a player closer to a loose ball is favoured to win it", () => {
    const state = newState();
    clearPitch(state);
    const ours = state.players.find((p) => p.side === "home" && p.position === "FWD")!;
    const theirs = state.players.find((p) => p.side === "away" && p.position === "DEF")!;
    ours.pos = { x: 70, y: 34 };
    theirs.pos = { x: 90, y: 34 };
    expect(looseBallWinChance(state, ours, { x: 72, y: 34 })).toBeGreaterThan(0.5);
  });
});

describe("decisions", () => {
  test("a striker unmarked in front of goal rates shooting highest", () => {
    const state = newState();
    clearPitch(state);
    const striker = state.players.find((p) => p.side === "home" && p.position === "FWD")!;
    striker.pos = { x: PITCH_LENGTH - 8, y: PITCH_WIDTH / 2 };
    giveBall(state, striker);
    const best = scoreOptions(state, striker).reduce((a, b) => (b.utility > a.utility ? b : a));
    expect(best.action.kind).toBe("shoot");
  });

  test("keepers only pass or kick long", () => {
    const state = newState();
    const keeper = state.players.find((p) => p.side === "home" && p.position === "GK")!;
    giveBall(state, keeper);
    const kinds = new Set(scoreOptions(state, keeper).map((o) => o.action.kind));
    expect([...kinds].sort()).toEqual(["clear", "pass"]);
  });
});

describe("full match", () => {
  test("same seed replays the same match", () => {
    const run = () => simulateEventMatch(world, world.clubs.strong!, world.clubs.weak!, seededRng(5));
    expect(run()).toEqual(run());
  });

  test("score matches the goals in the event log", () => {
    const r = simulateEventMatch(world, world.clubs.strong!, world.clubs.weak!, seededRng(6));
    const goals = (side: "home" | "away") =>
      r.events.filter((e) => e.type === "shot" && e.outcome === "goal" && e.side === side).length;
    expect(goals("home")).toBe(r.homeGoals);
    expect(goals("away")).toBe(r.awayGoals);
    const shotXg = r.events.reduce((s, e) => s + (e.type === "shot" && e.side === "home" ? e.xg : 0), 0);
    expect(shotXg).toBeCloseTo(r.homeXg);
  });

  test("events are in order and inside the 90 minutes", () => {
    const { events } = simulateEventMatch(world, world.clubs.strong!, world.clubs.weak!, seededRng(7));
    expect(events.length).toBeGreaterThan(100);
    for (let i = 1; i < events.length; i++) expect(events[i]!.time).toBeGreaterThanOrEqual(events[i - 1]!.time);
    expect(events.at(-1)!.time).toBeLessThanOrEqual(MATCH_SECONDS);
  });

  test("stronger club wins more often than it loses", () => {
    const rng = seededRng(8);
    let wins = 0;
    let losses = 0;
    for (let i = 0; i < 40; i++) {
      const r = simulateEventMatch(world, world.clubs.strong!, world.clubs.weak!, rng);
      if (r.homeGoals > r.awayGoals) wins++;
      else if (r.homeGoals < r.awayGoals) losses++;
    }
    expect(wins).toBeGreaterThan(losses * 2);
  });
});

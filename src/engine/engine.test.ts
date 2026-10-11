import { describe, expect, test } from "bun:test";
import { fixedManager, humanManager } from "../manager";
import { seededRng } from "../random";
import { strongVsWeak } from "../test-helpers";
import { MATCH_SECONDS } from "./constants";
import { scoreOptions } from "./decide";
import { anchor, assignSlots, keeperPosition } from "./formation";
import { distToSegment, moveTowards, PITCH_LENGTH, PITCH_WIDTH } from "./geometry";
import { applyTactics, createMatchState, isFullTime, simulateEventMatch, startEventMatch, stepEventMatch } from "./match";
import { giveBall, toTeamFrame, type MatchState } from "./state";
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

    const open = assessPass(state, passer!, receiver!.pos).success;
    defender.pos = { x: 50, y: 34 };
    const blocked = assessPass(state, passer!, receiver!.pos);
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
    const keeper = state.players.find((p) => p.side === "away" && p.position === "GK")!;
    keeper.pos = keeperPosition(state, keeper);
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

describe("tactics in the engine", () => {
  const balanced = fixedManager({ formation: "4-4-2", mentality: 0 });
  const balancedState = () =>
    createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(1), { home: balanced, away: balanced });

  test("the starting lineup follows the manager's formation", () => {
    const state = createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(1), {
      home: fixedManager({ formation: "3-4-3", mentality: 0 }),
      away: balanced,
    });
    const lines = (side: "home" | "away") =>
      state.players.filter((p) => p.side === side).reduce<Record<string, number>>((c, p) => ({ ...c, [p.position]: (c[p.position] ?? 0) + 1 }), {});
    expect(lines("home")).toEqual({ GK: 1, DEF: 3, MID: 4, FWD: 3 });
    expect(lines("away")).toEqual({ GK: 1, DEF: 4, MID: 4, FWD: 2 });
  });

  test("a formation change moves players between lines and is logged", () => {
    const state = balancedState();
    state.time = 600;
    applyTactics(state, "home", { formation: "5-4-1", mentality: -1 });
    const home = state.players.filter((p) => p.side === "home");
    expect(home.filter((p) => p.position === "DEF")).toHaveLength(5);
    expect(home.filter((p) => p.position === "FWD")).toHaveLength(1);
    // The new back five sits deeper than the midfield
    const depth = (pos: string) => Math.max(...home.filter((p) => p.position === pos).map((p) => p.slot.x));
    expect(depth("DEF")).toBeLessThan(Math.min(...home.filter((p) => p.position === "MID").map((p) => p.slot.x)));

    const event = state.events.at(-1)!;
    expect(event).toMatchObject({ type: "tactics", side: "home", time: 600, formation: "5-4-1", mentality: -1 });
    // 4-4-2 → 5-4-1: the deepest midfielder drops into defence, a forward drops into midfield
    expect(event.type === "tactics" && event.moved.map((m) => `${m.from}->${m.to}`).sort()).toEqual(["FWD->MID", "MID->DEF"]);
  });

  test("the same tactics again change nothing", () => {
    const state = balancedState();
    const before = state.events.length;
    applyTactics(state, "home", state.teams.home.tactics);
    expect(state.events).toHaveLength(before);
  });

  test("attacking teams commit more players forward when they have the ball", () => {
    const shapeDepth = (mentality: -2 | 2) => {
      const state = createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(1), {
        home: fixedManager({ formation: "4-4-2", mentality }),
      });
      const mid = state.players.find((p) => p.side === "home" && p.position === "MID")!;
      return toTeamFrame("home", anchor(state, mid, true)).x;
    };
    expect(shapeDepth(2)).toBeGreaterThan(shapeDepth(-2));
  });

  test("very defensive concedes less than very attacking against the same opponent", () => {
    const conceded = (mentality: -2 | 2) => {
      const rng = seededRng(21);
      let total = 0;
      for (let i = 0; i < 40; i++) {
        total += simulateEventMatch(world, world.clubs.strong!, world.clubs.weak!, rng, {
          home: fixedManager({ formation: "4-4-2", mentality }),
          away: fixedManager({ formation: "4-4-2", mentality: 0 }),
        }).awayGoals;
      }
      return total;
    };
    expect(conceded(-2)).toBeLessThan(conceded(2));
  });

  test("managers change tactics during a match", () => {
    let changes = 0;
    const rng = seededRng(9);
    for (let i = 0; i < 10; i++) {
      const { events } = simulateEventMatch(world, world.clubs.strong!, world.clubs.weak!, rng);
      changes += events.filter((e) => e.type === "tactics" && e.time > 0).length;
    }
    expect(changes).toBeGreaterThan(0);
  });
});

describe("stepping a match", () => {
  test("stepping to full time plays the same match as simulating it", () => {
    const { strong, weak } = world.clubs;
    const state = startEventMatch(world, strong!, weak!, seededRng(3));
    while (!isFullTime(state)) stepEventMatch(state);
    const result = simulateEventMatch(world, strong!, weak!, seededRng(3));
    expect(state.time).toBe(MATCH_SECONDS);
    expect(state.score).toEqual({ home: result.homeGoals, away: result.awayGoals });
    expect(state.events).toEqual(result.events);
  });

  test("a human manager's changes stick until they change them again", () => {
    const { strong, weak } = world.clubs;
    const managers = { home: humanManager({ formation: "4-4-2", mentality: 0 }) };
    const state = startEventMatch(world, strong!, weak!, seededRng(4), managers);
    for (let t = 0; t < 600; t++) stepEventMatch(state);
    applyTactics(state, "home", { formation: "3-4-3", mentality: 2 });
    while (!isFullTime(state)) stepEventMatch(state);
    expect(state.teams.home.tactics).toEqual({ formation: "3-4-3", mentality: 2 });
  });
});

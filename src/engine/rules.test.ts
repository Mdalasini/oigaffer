import { describe, expect, test } from "bun:test";
import { fixedManager } from "../manager";
import type { GameWorld } from "../model";
import { seededRng } from "../random";
import { player, SLOW_TEST, strongVsWeak } from "../test-helpers";
import { MAX_SUBS, THROW_MAX_DISTANCE, WALL_DISTANCE } from "./constants";
import { scoreOptions } from "./decide";
import { dist, PITCH_LENGTH, PITCH_WIDTH } from "./geometry";
import { makePendingSubs, requestSub, sendOff, substitute } from "./lineup";
import { createMatchState, isFullTime, simulateEventMatch, stepEventMatch, tick } from "./match";
import { moveOffBall } from "./movement";
import { judgeFoul } from "./referee";
import { act } from "./resolve";
import { awardFreeKick, placeBall } from "./restarts";
import { ballDead, giveBall, keeperOf, owner, type MatchPlayer, type MatchState } from "./state";

// Two clubs of equal quality, each with a bench (a spare keeper, defender, midfielder and forward)
function withBenches(): GameWorld {
  const world = strongVsWeak(12, 12);
  for (const [clubId, prefix] of [["strong", "sb"], ["weak", "wb"]] as const) {
    const extra = [player(`${prefix}gk`, "GK", 3, 11), player(`${prefix}d`, "DEF", 8, 11), player(`${prefix}m`, "MID", 11, 9), player(`${prefix}f`, "FWD", 11, 4)];
    for (const p of extra) world.players[p.id] = p;
    world.clubs[clubId]!.playerIds.push(...extra.map((p) => p.id));
  }
  return world;
}

const balanced = fixedManager({ formation: "4-4-2", mentality: 0 });
const newState = (world: GameWorld = strongVsWeak(12, 12), seed = 1): MatchState =>
  createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(seed), { home: balanced, away: balanced });

const team = (state: MatchState, side: "home" | "away") => state.players.filter((p) => p.side === side);
const byRole = (state: MatchState, side: "home" | "away", role: string) => team(state, side).filter((p) => p.position === role);

// Everyone well out of the way (away players upfield, so they don't affect offside) so a test can stage a situation
function clearPitch(state: MatchState) {
  for (const p of state.players) p.pos = p.side === "home" ? { x: 2, y: 2 } : { x: 40, y: 66 };
}

describe("ball out of play", () => {
  test("over the touchline is a throw-in to the other side", () => {
    const state = newState();
    placeBall(state, { x: 40, y: -2 }, "home");
    const taker = owner(state)!;
    expect(taker.side).toBe("away");
    expect(state.ball.setPiece).toBe("throw_in");
    expect(taker.pos).toEqual({ x: 40, y: 0 });
    expect(ballDead(state)).toBe(true);
  });

  test("over your own goal line is a corner; over theirs is a goal kick", () => {
    const corner = newState();
    placeBall(corner, { x: -1, y: 20 }, "home"); // home defends x = 0
    expect(corner.ball.setPiece).toBe("corner");
    expect(owner(corner)!.side).toBe("away");
    expect(owner(corner)!.pos).toEqual({ x: 0, y: 0 });

    const goalKick = newState();
    placeBall(goalKick, { x: -1, y: 20 }, "away");
    expect(goalKick.ball.setPiece).toBe("goal_kick");
    expect(owner(goalKick)).toBe(keeperOf(goalKick, "home"));
  });
});

describe("restarts limit what the taker can do", () => {
  test("a throw-in can only be passed, and not far", () => {
    const state = newState();
    placeBall(state, { x: 50, y: -1 }, "away");
    // Teammates come short while it's set up
    for (let t = 0; t < 5; t++) moveOffBall(state);
    const options = scoreOptions(state, owner(state)!);
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      expect(["pass", "through"]).toContain(o.action.kind);
      if (o.action.kind === "pass") expect(dist(owner(state)!.pos, o.action.receiver.pos)).toBeLessThanOrEqual(THROW_MAX_DISTANCE);
    }
  });

  test("a corner is crossed into the box", () => {
    const state = newState();
    clearPitch(state);
    const [a, b] = byRole(state, "home", "FWD");
    a!.pos = { x: 98, y: 30 };
    b!.pos = { x: 96, y: 38 };
    placeBall(state, { x: 106, y: 10 }, "away");
    expect(state.ball.setPiece).toBe("corner");
    const kinds = new Set(scoreOptions(state, owner(state)!).map((o) => o.action.kind));
    expect([...kinds]).toEqual(["cross"]);
  });

  test("a foul in the box is a penalty, and the taker has to shoot", () => {
    const state = newState();
    awardFreeKick(state, "home", { x: 98, y: 34 }, true);
    expect(state.ball.setPiece).toBe("penalty");
    expect(owner(state)!.pos).toEqual({ x: PITCH_LENGTH - 11, y: PITCH_WIDTH / 2 });
    const options = scoreOptions(state, owner(state)!);
    expect(options.map((o) => o.action.kind === "shoot" && o.action.shot)).toEqual(["penalty"]);
  });

  test("opponents stand back from a free kick", () => {
    const state = newState();
    awardFreeKick(state, "home", { x: 70, y: 34 }, true);
    for (const p of team(state, "away")) p.pos = { x: 71, y: 34 };
    moveOffBall(state);
    for (const p of team(state, "away")) expect(dist(p.pos, state.ball.pos)).toBeGreaterThanOrEqual(WALL_DISTANCE - 1e-9);
  });
});

describe("offside", () => {
  test("a pass to someone beyond the second-last defender is flagged", () => {
    const state = newState();
    clearPitch(state);
    const passer = byRole(state, "home", "MID")[0]!;
    const runner = byRole(state, "home", "FWD")[0]!;
    passer.pos = { x: 60, y: 34 };
    runner.pos = { x: 92, y: 34 };
    for (const d of byRole(state, "away", "DEF")) d.pos = { x: 85, y: 30 };
    keeperOf(state, "away")!.pos = { x: 104, y: 34 };
    giveBall(state, passer, 0);

    act(state, passer, { kind: "pass", receiver: runner, success: 1, risks: [] });
    expect(state.events.at(-2)).toMatchObject({ type: "offside", side: "home", playerId: runner.id });
    expect(state.ball.setPiece).toBe("indirect_free_kick");
    expect(owner(state)!.side).toBe("away");
  });

  test("level with the defender is onside", () => {
    const state = newState();
    clearPitch(state);
    const passer = byRole(state, "home", "MID")[0]!;
    const runner = byRole(state, "home", "FWD")[0]!;
    passer.pos = { x: 60, y: 34 };
    runner.pos = { x: 85, y: 34 };
    for (const d of byRole(state, "away", "DEF")) d.pos = { x: 85, y: 30 };
    giveBall(state, passer, 0);
    act(state, passer, { kind: "pass", receiver: runner, success: 1, risks: [] });
    expect(owner(state)).toBe(runner);
  });
});

describe("fouls and cards", () => {
  test("bringing down a clear run on goal as the last defender is a red card", () => {
    const state = newState();
    clearPitch(state);
    const attacker = byRole(state, "home", "FWD")[0]!;
    const lastMan = byRole(state, "away", "DEF")[0]!;
    attacker.pos = { x: 84, y: 34 }; // just outside the box
    lastMan.pos = { x: 83, y: 35 };
    giveBall(state, attacker, 0);

    judgeFoul(state, lastMan, attacker, false);
    expect(state.events.some((e) => e.type === "card" && e.card === "red" && e.playerId === lastMan.id)).toBe(true);
    expect(team(state, "away")).toHaveLength(10);
    expect(state.offPitch.find((o) => o.id === lastMan.id)?.reason).toBe("sent_off");
    expect(state.ball.setPiece).toBe("free_kick");
    expect(owner(state)!.side).toBe("home");
  });

  test("a side down to ten still fields a keeper and keeps its back line", () => {
    const state = newState();
    sendOff(state, keeperOf(state, "home")!);
    const home = team(state, "home");
    expect(home).toHaveLength(10);
    expect(home.filter((p) => p.position === "GK")).toHaveLength(1);
    expect(home.filter((p) => p.position === "DEF")).toHaveLength(4);
  });
});

describe("substitutions", () => {
  test("changes wait for the ball to go dead, and the replacement takes the role", () => {
    const state = newState(withBenches());
    const off = byRole(state, "home", "MID")[0]!;
    giveBall(state, byRole(state, "home", "DEF")[0]!, 0);
    expect(requestSub(state, "home", off.id, "sbm")).toBe(true);

    tick(state);
    expect(state.players.some((p) => p.id === off.id)).toBe(true);

    placeBall(state, { x: 50, y: -1 }, "away"); // out for a throw: play stops
    state.time++;
    // The match loop makes pending changes at a dead ball
    makePendingSubs(state);
    const on = state.players.find((p) => p.id === "sbm")!;
    expect(on.position).toBe("MID");
    expect(on.energy).toBe(1);
    expect(state.players.some((p) => p.id === off.id)).toBe(false);
    expect(state.teams.home.subsUsed).toBe(1);
  });

  test("a sub keeper takes the gloves back from an outfield stand-in", () => {
    const state = newState(withBenches());
    sendOff(state, keeperOf(state, "home")!);
    const standIn = keeperOf(state, "home")!;
    expect(standIn.natural).not.toBe("GK");
    const forward = byRole(state, "home", "FWD")[0]!;
    substitute(state, "home", forward.id, "sbgk");
    expect(keeperOf(state, "home")!.id).toBe("sbgk");
    expect(standIn.position).toBe("FWD");
  });

  test("nobody can make more than the allowed changes", () => {
    const world = withBenches();
    // A deep bench of extra midfielders
    for (let i = 0; i < 6; i++) {
      const p = player(`extra${i}`, "MID", 10, 10);
      world.players[p.id] = p;
      world.clubs.strong!.playerIds.push(p.id);
    }
    const state = newState(world);
    let made = 0;
    for (let i = 0; i < 6; i++) {
      const off = team(state, "home").find((p) => p.position !== "GK" && !p.id.startsWith("extra"))!;
      if (substitute(state, "home", off.id, `extra${i}`)) made++;
    }
    expect(made).toBe(MAX_SUBS);
  });
});

describe("a full match", () => {
  test("players tire, and tired players are weaker", () => {
    const world = withBenches();
    const state = newState(world, 3);
    while (!isFullTime(state)) stepEventMatch(state);
    const starters = state.players.filter((p: MatchPlayer) => p.position !== "GK" && p.energy < 1);
    expect(starters.length).toBeGreaterThan(0);
    for (const p of starters) expect(p.attributes.passing).toBeLessThan(p.base.passing);
  }, SLOW_TEST);

  test("restarts, fouls and cards turn up at sensible rates", () => {
    const world = withBenches();
    const rng = seededRng(11);
    const n = 20;
    let fouls = 0, corners = 0, throwIns = 0, yellows = 0, offsides = 0;
    for (let i = 0; i < n; i++) {
      const { events } = simulateEventMatch(world, world.clubs.strong!, world.clubs.weak!, rng);
      for (const e of events) {
        if (e.type === "foul") fouls++;
        if (e.type === "card" && e.card === "yellow") yellows++;
        if (e.type === "offside") offsides++;
        if (e.type === "set_piece" && e.kind === "corner") corners++;
        if (e.type === "set_piece" && e.kind === "throw_in") throwIns++;
      }
    }
    const perTeam = (x: number) => x / n / 2;
    expect(perTeam(fouls)).toBeGreaterThan(4);
    expect(perTeam(fouls)).toBeLessThan(20);
    expect(perTeam(corners)).toBeGreaterThan(0.5);
    expect(perTeam(throwIns)).toBeGreaterThan(5);
    expect(perTeam(yellows)).toBeGreaterThan(0.3);
    expect(perTeam(yellows)).toBeLessThan(4);
    expect(perTeam(offsides)).toBeGreaterThan(0.3);
  }, SLOW_TEST);
});

test("changes asked for during the break are made before the second half", () => {
  const state = newState(withBenches());
  state.phase = "half_time";
  state.clock = 2760;
  const off = byRole(state, "home", "FWD")[0]!;
  expect(requestSub(state, "home", off.id, "sbf")).toBe(true);
  stepEventMatch(state);
  expect(state.events.some((e) => e.type === "substitution" && e.onId === "sbf" && e.period === 2)).toBe(true);
});

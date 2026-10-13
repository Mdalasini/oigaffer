import { describe, expect, test } from "bun:test";
import { fixedManager, humanManager } from "../manager";
import { seededRng } from "../random";
import { SLOW_TEST, strongVsWeak } from "../test-helpers";
import { MATCH_SECONDS } from "./constants";
import { scoreOptions } from "./decide";
import { anchor, keeperPosition, phaseAt, spotSlot } from "./formation";
import { distToSegment, moveTowards, PITCH_LENGTH, PITCH_WIDTH } from "./geometry";
import { applyTactics, createMatchState, isFullTime, moveSpot, simulateEventMatch, startEventMatch, stepEventMatch, swapPlayers } from "./match";
import { FORMATIONS, type Spot } from "../tactics";
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

test("4-4-2 slots spread the wide players and close up the centre-backs", () => {
  const formation = ["GK", ...FORMATIONS["4-4-2"]] as const;
  const ys = (spots: Spot[]) => spots.map((s) => spotSlot(s, formation).y);
  expect(spotSlot("GK", formation)).toEqual({ x: 4, y: PITCH_WIDTH / 2 });
  // A back four spread evenly across the pitch
  [1, 2, 3, 4].forEach((i, n) => expect(ys(["LB", "LCB", "RCB", "RB"])[n]).toBeCloseTo((PITCH_WIDTH * i) / 5));
  expect(ys(["LF", "RF"])).toEqual([PITCH_WIDTH / 3, (2 * PITCH_WIDTH) / 3]);
  // With a centre-back between them, the other two stay in their columns
  expect(spotSlot("LCB", ["GK", ...FORMATIONS["5-3-2"]]).y).toBeCloseTo(PITCH_WIDTH / 3);
});

test("4-3-3 lines its players up in their board positions", () => {
  const state = createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(1), {
    home: fixedManager({ formation: "4-3-3", mentality: 0 }),
    away: fixedManager({ formation: "4-4-2", mentality: 0 }),
  });
  const home = state.players.filter((p) => p.side === "home").sort((a, b) => a.slot.y - b.slot.y);
  const spots = (line: string) => home.filter((p) => p.position === line).map((p) => p.spot);
  expect(spots("DEF")).toEqual(["LB", "LCB", "RCB", "RB"]);
  expect(spots("MID")).toEqual(["LCM", "CDM", "RCM"]);
  expect(spots("FWD")).toEqual(["LW", "CF", "RW"]);
  const at = (spot: string) => home.find((p) => p.spot === spot)!.slot;
  // The holding midfielder sits behind the other two, the wingers behind the centre-forward
  expect(at("CDM").x).toBeLessThan(at("LCM").x);
  expect(at("LW").x).toBeLessThan(at("CF").x);
});

describe("moving players on the board", () => {
  const start = () =>
    createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(1), {
      home: fixedManager({ formation: "4-3-3", mentality: 0 }),
    });
  const at = (state: MatchState, spot: Spot) => state.players.find((p) => p.side === "home" && p.spot === spot)!;

  test("a position moves with its player, who takes the new position's line", () => {
    const state = start();
    const lcm = at(state, "LCM");
    const rcm = at(state, "RCM");
    const cdm = at(state, "CDM");
    expect(moveSpot(state, "home", "LCM", "LDM")).toBe(true);
    expect(moveSpot(state, "home", "RCM", "RDM")).toBe(true);
    expect(moveSpot(state, "home", "CDM", "CAM")).toBe(true);
    expect([lcm.spot, rcm.spot, cdm.spot]).toEqual(["LDM", "RDM", "CAM"]);
    expect(cdm.slot.x).toBeGreaterThan(lcm.slot.x);
    expect(state.events.at(-1)).toMatchObject({ type: "tactics", formation: "4-2-3-1" });
    // A winger dropping into midfield joins the midfield line
    const lw = at(state, "LW");
    moveSpot(state, "home", "LW", "LM");
    expect(lw.position).toBe("MID");
    // Occupied positions and the keeper can't be moved onto
    expect(moveSpot(state, "home", "LM", "CF")).toBe(false);
    expect(moveSpot(state, "home", "LM", "GK")).toBe(false);
  });

  test("two players trade positions and keep them when the tactics change", () => {
    const state = start();
    const lb = at(state, "LB");
    const cf = at(state, "CF");
    expect(swapPlayers(state, "home", lb.id, cf.id)).toBe(true);
    expect([lb.spot, lb.position, cf.spot, cf.position]).toEqual(["CF", "FWD", "LB", "DEF"]);
    applyTactics(state, "home", { ...state.teams.home.tactics, mentality: 1 });
    expect([lb.spot, cf.spot]).toEqual(["CF", "LB"]);
    expect(swapPlayers(state, "home", lb.id, at(state, "GK").id)).toBe(false);
  });
});

describe("out-of-possession shape", () => {
  const fourThreeThree = (): MatchState => {
    const state = createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(1), {
      home: fixedManager({ formation: "4-3-3", mentality: 0 }),
    });
    // Wingers drop into a midfield five without the ball
    moveSpot(state, "home", "LW", "LM", "out");
    moveSpot(state, "home", "RW", "RM", "out");
    return state;
  };
  const at = (state: MatchState, spot: Spot) => state.players.find((p) => p.side === "home" && p.spot === spot)!;

  test("each player drops to their paired position, line and slot", () => {
    const state = fourThreeThree();
    const lw = at(state, "LW");
    for (const block of ["high_block", "mid_block", "low_block"] as const) {
      expect([lw.roles[block].spot, lw.roles[block].position]).toEqual(["LM", "MID"]);
      expect(lw.roles[block].slot.x).toBeLessThan(lw.slot.x);
    }
    expect(lw.roles.final_third).toEqual({ spot: "LW", position: "FWD", slot: lw.slot });
    // Everyone else keeps their position
    const cf = at(state, "CF");
    expect([cf.roles.mid_block.spot, cf.roles.mid_block.slot]).toEqual([cf.spot, cf.slot]);
    expect(state.events.at(-1)).toMatchObject({ type: "tactics", formation: "4-3-3", outOfPossession: "4-1-4-1" });
    // The anchor without the ball is built on the deeper slot
    giveBall(state, state.players.find((p) => p.side === "away" && p.position === "MID")!);
    expect(toTeamFrame("home", anchor(state, lw, false)).x).toBeLessThan(toTeamFrame("home", anchor(state, lw, true)).x);
  });

  test("players swapped on the board take their new positions' out-of-possession places", () => {
    const state = fourThreeThree();
    const lw = at(state, "LW");
    const lcm = at(state, "LCM");
    swapPlayers(state, "home", lw.id, lcm.id);
    expect([lcm.spot, lcm.roles.mid_block.spot, lw.spot, lw.roles.mid_block.spot]).toEqual(["LW", "LM", "LCM", "LCM"]);
  });

  test("moving an in-possession position leaves the paired out-of-possession one alone", () => {
    const state = fourThreeThree();
    const lw = at(state, "LW");
    moveSpot(state, "home", "LW", "LAM");
    expect([lw.spot, lw.roles.mid_block.spot]).toEqual(["LAM", "LM"]);
  });
});

describe("phases of play", () => {
  test("the ball's third sets the phase", () => {
    expect([10, 50, 90].map((x) => phaseAt(x, true))).toEqual(["build_up", "middle_third", "final_third"]);
    expect([10, 50, 90].map((x) => phaseAt(x, false))).toEqual(["low_block", "mid_block", "high_block"]);
  });

  test("a phase's own shape takes over only while the ball is in that third", () => {
    const state = createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(1), {
      home: fixedManager({ formation: "4-3-3", mentality: 0 }),
    });
    // Building up, the holding midfielder drops between the centre-backs
    moveSpot(state, "home", "CDM", "CB", "build_up");
    const cdm = state.players.find((p) => p.side === "home" && p.spot === "CDM")!;
    expect(cdm.roles.build_up).toMatchObject({ spot: "CB", position: "DEF" });
    expect(cdm.roles.middle_third.spot).toBe("CDM");
    giveBall(state, cdm);
    const depth = (ballX: number) => {
      state.ball.pos = { x: ballX, y: PITCH_WIDTH / 2 };
      return anchor(state, cdm, true).x - (ballX - PITCH_LENGTH / 2) * 0.6;
    };
    // Same ball-following shift either side of the line: only the slot changes
    expect(depth(34)).toBeLessThan(depth(36) - 5);
  });
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

  test("events are in order, and the match runs 90 minutes plus added time", () => {
    const { events } = simulateEventMatch(world, world.clubs.strong!, world.clubs.weak!, seededRng(7));
    expect(events.length).toBeGreaterThan(100);
    for (let i = 1; i < events.length; i++) expect(events[i]!.time).toBeGreaterThanOrEqual(events[i - 1]!.time);
    const added = events.filter((e) => e.type === "added_time");
    expect(added.map((e) => e.period)).toEqual([1, 2]);
    expect(events.filter((e) => e.type === "whistle").map((e) => e.type === "whistle" && e.phase)).toEqual(["half_time", "full_time"]);
    const last = events.at(-1)!;
    expect(last).toMatchObject({ type: "whistle", phase: "full_time", period: 2 });
    expect(last.clock).toBeGreaterThan(MATCH_SECONDS);
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
  }, SLOW_TEST);
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

  test("an underdog that sits deep concedes less, and the game has fewer goals", () => {
    // A few hundred matches: at 100 the result depends on the seed
    const play = (mentality: -2 | 0) => {
      const rng = seededRng(21);
      let conceded = 0;
      let total = 0;
      for (let i = 0; i < 300; i++) {
        const r = simulateEventMatch(world, world.clubs.weak!, world.clubs.strong!, rng, {
          home: fixedManager({ formation: "4-4-2", mentality }),
          away: fixedManager({ formation: "4-4-2", mentality: 0 }),
        });
        conceded += r.awayGoals;
        total += r.homeGoals + r.awayGoals;
      }
      return { conceded, total };
    };
    const deep = play(-2);
    const open = play(0);
    expect(deep.conceded).toBeLessThan(open.conceded);
    expect(deep.total).toBeLessThan(open.total);
  }, 2 * SLOW_TEST);

  test("managers change tactics during a match", () => {
    let changes = 0;
    const rng = seededRng(9);
    for (let i = 0; i < 10; i++) {
      const { events } = simulateEventMatch(world, world.clubs.strong!, world.clubs.weak!, rng);
      changes += events.filter((e) => e.type === "tactics" && e.time > 0).length;
    }
    expect(changes).toBeGreaterThan(0);
  }, SLOW_TEST);
});

describe("stepping a match", () => {
  test("stepping to full time plays the same match as simulating it", () => {
    const { strong, weak } = world.clubs;
    const state = startEventMatch(world, strong!, weak!, seededRng(3));
    while (!isFullTime(state)) stepEventMatch(state);
    const result = simulateEventMatch(world, strong!, weak!, seededRng(3));
    expect(state.clock).toBeGreaterThan(MATCH_SECONDS);
    expect(state.score).toEqual({ home: result.homeGoals, away: result.awayGoals });
    expect(state.events).toEqual(result.events);
  }, SLOW_TEST);

  test("a human manager's changes stick until they change them again", () => {
    const { strong, weak } = world.clubs;
    const managers = { home: humanManager({ formation: "4-4-2", mentality: 0 }) };
    const state = startEventMatch(world, strong!, weak!, seededRng(4), managers);
    for (let t = 0; t < 600; t++) stepEventMatch(state);
    applyTactics(state, "home", { formation: "3-4-3", mentality: 2 });
    while (!isFullTime(state)) stepEventMatch(state);
    expect(state.teams.home.tactics).toEqual({ formation: "3-4-3", mentality: 2 });
  }, SLOW_TEST);
});

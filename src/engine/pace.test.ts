import { describe, expect, test } from "bun:test";
import { fixedManager } from "../manager";
import type { GameWorld } from "../model";
import { seededRng } from "../random";
import { SLOW_TEST, strongVsWeak } from "../test-helpers";
import { STEER_MAX_SPEED } from "./constants";
import { createMatchState, simulateEventMatch } from "./match";
import type { MatchPlayer, MatchState } from "./state";
import { steerPlayer } from "./steering";
import { raceWinChance } from "./valuation";

function setup(): MatchState {
  const world = strongVsWeak(12, 12);
  const manager = fixedManager({ formation: "4-4-2", mentality: 0 });
  return createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(41), { home: manager, away: manager });
}

// Sets both the fresh attributes and the match base, so the value holds through refreshes
function setPhysical(p: MatchPlayer, pace: number, acceleration: number): void {
  p.base.pace = pace; p.attributes.pace = pace;
  p.base.acceleration = acceleration; p.attributes.acceleration = acceleration;
}

const speedOf = (p: MatchPlayer) => Math.hypot(p.vel.x, p.vel.y);

describe("pace and acceleration in steering", () => {
  test("a faster player covers more ground and finishes faster at a sprint", () => {
    const state = setup();
    const fast = state.players[1]!, slow = state.players[2]!;
    setPhysical(fast, 18, 10);
    setPhysical(slow, 4, 10);
    fast.pos = { x: 2, y: 20 }; fast.vel = { x: 0, y: 0 };
    slow.pos = { x: 2, y: 40 }; slow.vel = { x: 0, y: 0 };
    // Target 100 m away: neither player arrives within 10 ticks, so braking does not interfere
    for (let i = 0; i < 10; i++) {
      steerPlayer(fast, { x: 102, y: 20 }, STEER_MAX_SPEED, 0, state.ball.pos);
      steerPlayer(slow, { x: 102, y: 40 }, STEER_MAX_SPEED, 0, state.ball.pos);
    }
    expect(fast.pos.x - 2).toBeGreaterThan(slow.pos.x - 2);
    expect(speedOf(fast)).toBeGreaterThan(speedOf(slow));
  });

  test("acceleration decides the first ticks; both reach the same top speed", () => {
    const state = setup();
    const quick = state.players[1]!, sluggish = state.players[2]!;
    setPhysical(quick, 10, 18);
    setPhysical(sluggish, 10, 4);
    quick.pos = { x: 2, y: 20 }; quick.vel = { x: 0, y: 0 };
    sluggish.pos = { x: 2, y: 40 }; sluggish.vel = { x: 0, y: 0 };
    steerPlayer(quick, { x: 102, y: 20 }, STEER_MAX_SPEED, 0, state.ball.pos);
    steerPlayer(sluggish, { x: 102, y: 40 }, STEER_MAX_SPEED, 0, state.ball.pos);
    expect(speedOf(quick)).toBeGreaterThan(speedOf(sluggish));
    for (let i = 1; i < 10; i++) {
      steerPlayer(quick, { x: 102, y: 20 }, STEER_MAX_SPEED, 0, state.ball.pos);
      steerPlayer(sluggish, { x: 102, y: 40 }, STEER_MAX_SPEED, 0, state.ball.pos);
    }
    expect(speedOf(quick)).toBeCloseTo(STEER_MAX_SPEED, 1);
    expect(speedOf(sluggish)).toBeCloseTo(STEER_MAX_SPEED, 1);
  });
});

describe("pace in race estimates", () => {
  test("a fast runner has a better chance in a race to a loose ball than an identical slow one", () => {
    const state = setup();
    const runner = state.players.find((p) => p.side === "home" && p.position !== "GK")!;
    runner.pos = { x: 50, y: 34 };
    const target = { x: 62, y: 34 };
    setPhysical(runner, 18, 10);
    const fast = raceWinChance(state, runner, target);
    setPhysical(runner, 4, 10);
    const slow = raceWinChance(state, runner, target);
    expect(fast).toBeGreaterThan(slow);
  });
});

describe("pace in matches", () => {
  test("a side of fast, quick players scores more than a slow side over many matches", () => {
    const world: GameWorld = strongVsWeak(12, 12);
    for (const id of world.clubs.strong!.playerIds) {
      const p = world.players[id]!;
      if (p.position === "GK") continue;
      p.attributes.pace = 17; p.attributes.acceleration = 17;
    }
    for (const id of world.clubs.weak!.playerIds) {
      const p = world.players[id]!;
      if (p.position === "GK") continue;
      p.attributes.pace = 5; p.attributes.acceleration = 5;
    }
    let fastGoals = 0, slowGoals = 0;
    for (let seed = 1; seed <= 40; seed++) {
      // Alternate home and away so home advantage can't explain the result
      const fastHome = seed % 2 === 0;
      const [home, away] = fastHome ? [world.clubs.strong!, world.clubs.weak!] : [world.clubs.weak!, world.clubs.strong!];
      const r = simulateEventMatch(world, home, away, seededRng(seed));
      fastGoals += fastHome ? r.homeGoals : r.awayGoals;
      slowGoals += fastHome ? r.awayGoals : r.homeGoals;
    }
    expect(fastGoals).toBeGreaterThan(slowGoals);
  }, SLOW_TEST);
});

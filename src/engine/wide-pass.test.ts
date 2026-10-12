import { describe, expect, test } from "bun:test";
import { seededRng } from "../random";
import { strongVsWeak } from "../test-helpers";
import { PASS_ERROR_RADIUS, WIDE_PASS_ERROR_SPREAD } from "./constants";
import type { Action } from "./decide";
import { createMatchState } from "./match";
import { act } from "./resolve";
import { giveBall } from "./state";

// A pass down the touchline that is mis-hit (success 0, no interceptors) lands within
// the spread of the struck lane, measured from the intended spot.
describe("wide mis-hit passes", () => {
  test("a wide mis-hit's error stays within the spread of the struck lane", () => {
    const world = strongVsWeak(12, 12);
    for (let seed = 1; seed <= 100; seed++) {
      const state = createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(seed));
      const passer = state.players.find(p => p.side === "home" && p.position === "MID")!;
      const receiver = state.players.find(p => p.side === "home" && p.position === "FWD")!;
      passer.pos = { x: 60, y: 6 };
      receiver.pos = { x: 75, y: 5 };
      giveBall(state, passer);
      const action: Action = { kind: "pass", receiver, success: 0, risks: [] };
      act(state, passer, action);

      const landing = state.ball.flight!.destination;
      const lane = { x: receiver.pos.x - passer.pos.x, y: receiver.pos.y - passer.pos.y };
      const error = { x: landing.x - receiver.pos.x, y: landing.y - receiver.pos.y };
      const size = Math.hypot(error.x, error.y);
      expect(size).toBeGreaterThanOrEqual(PASS_ERROR_RADIUS[0] - 1e-9);
      expect(size).toBeLessThanOrEqual(PASS_ERROR_RADIUS[1] + 1e-9);
      const cos = (lane.x * error.x + lane.y * error.y) / (Math.hypot(lane.x, lane.y) * size);
      expect(Math.acos(Math.min(1, Math.max(-1, cos)))).toBeLessThanOrEqual(WIDE_PASS_ERROR_SPREAD + 1e-9);
    }
  });
});

import { expect, test } from "bun:test";
import type { MatchEvent } from "./engine/state";
import { teamStats } from "./stats";

test("team stats count from the event log", () => {
  const events: MatchEvent[] = [
    { time: 1, side: "home", type: "pass", playerId: "a", receiverId: "b" },
    { time: 2, side: "home", type: "pass", playerId: "b", receiverId: "c" },
    { time: 3, side: "away", type: "interception", playerId: "c", interceptorId: "z" },
    { time: 4, side: "away", type: "pass", playerId: "z", receiverId: "y" },
    { time: 5, side: "away", type: "shot", playerId: "y", xg: 0.3, outcome: "goal" },
    { time: 6, side: "home", type: "shot", playerId: "a", xg: 0.1, outcome: "blocked" },
  ];
  const home = teamStats(events, "home");
  const away = teamStats(events, "away");
  expect(home).toMatchObject({ goals: 0, shots: 1, onTarget: 0, passes: 2 });
  expect(home.passAccuracy).toBeCloseTo(2 / 3);
  expect(home.possession).toBeCloseTo(2 / 3);
  expect(away).toMatchObject({ goals: 1, shots: 1, onTarget: 1, interceptions: 1 });
  expect(away.xg).toBeCloseTo(0.3);
});

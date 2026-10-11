import { describe, expect, test } from "bun:test";
import { commentary, describe as describeEvent, matchMinute, type Names } from "./commentary";
import { HALF_TIME, MATCH_SECONDS } from "./engine/constants";
import type { MatchEvent } from "./engine/state";

const names: Names = { club: (s) => (s === "home" ? "Home FC" : "Away FC"), player: (id) => id.toUpperCase() };

describe("commentary", () => {
  test("goals name the scorer and the club", () => {
    const e: MatchEvent = { time: 100, side: "away", type: "shot", playerId: "x", xg: 0.1, outcome: "goal" };
    expect(describeEvent(e, names)).toMatchObject({ kind: "goal", text: "GOAL! X scores for Away FC!" });
  });

  test("routine play stays out of the feed", () => {
    const e: MatchEvent = { time: 5, side: "home", type: "pass", playerId: "a", receiverId: "b" };
    expect(describeEvent(e, names)).toBeNull();
  });

  test("tactical changes list who moved", () => {
    const e: MatchEvent = {
      time: 900,
      side: "home",
      type: "tactics",
      formation: "3-4-3",
      mentality: 2,
      moved: [{ playerId: "d", from: "DEF", to: "MID" }],
    };
    expect(describeEvent(e, names)?.text).toBe("Home FC switch to 3-4-3, very attacking (D DEF→MID).");
  });

  test("whistles appear once their time has come", () => {
    const events: MatchEvent[] = [{ time: 0, side: "home", type: "kickoff" }];
    expect(commentary(events, 100, names).map((l) => l.text)).toEqual(["Home FC get us under way."]);
    const atEnd = commentary(events, MATCH_SECONDS, names).map((l) => l.text);
    expect(atEnd).toEqual(["Home FC get us under way.", "Half time.", "Full time."]);
  });

  test("half time sits between the halves", () => {
    const events: MatchEvent[] = [
      { time: HALF_TIME - 10, side: "home", type: "shot", playerId: "a", xg: 0.1, outcome: "off_target" },
      { time: HALF_TIME + 1, side: "away", type: "kickoff" },
    ];
    expect(commentary(events, HALF_TIME + 5, names).map((l) => l.text)).toEqual([
      "A fires wide.",
      "Half time.",
      "The second half begins.",
    ]);
  });

  test("minutes count from 1' to 90'", () => {
    expect(matchMinute(0)).toBe(1);
    expect(matchMinute(60)).toBe(1);
    expect(matchMinute(61)).toBe(2);
    expect(matchMinute(MATCH_SECONDS)).toBe(90);
  });
});

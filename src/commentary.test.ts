import { describe, expect, test } from "bun:test";
import { commentary, describe as describeEvent, minuteLabel, type Names } from "./commentary";
import { HALF_TIME } from "./engine/constants";
import type { MatchEvent } from "./engine/state";

const names: Names = { club: (s) => (s === "home" ? "Home FC" : "Away FC"), player: (id) => id.toUpperCase() };
const at = (clock: number, period: 1 | 2 = 1) => ({ time: clock, clock, period });

describe("commentary", () => {
  test("goals name the scorer and the club, and say how it went in", () => {
    const shot: MatchEvent = { ...at(100), side: "away", type: "shot", playerId: "x", xg: 0.1, outcome: "goal", kind: "open_play" };
    expect(describeEvent(shot, names)).toMatchObject({ kind: "goal", text: "GOAL! X scores for Away FC!" });
    const header: MatchEvent = { ...shot, kind: "header" };
    expect(describeEvent(header, names)?.text).toBe("GOAL! X heads in for Away FC!");
  });

  test("routine play stays out of the feed", () => {
    const e: MatchEvent = { ...at(5), side: "home", type: "pass", playerId: "a", receiverId: "b" };
    expect(describeEvent(e, names)).toBeNull();
  });

  test("tactical changes list who moved", () => {
    const e: MatchEvent = {
      ...at(900),
      side: "home",
      type: "tactics",
      formation: "3-4-3",
      mentality: 2,
      moved: [{ playerId: "d", from: "DEF", to: "MID" }],
    };
    expect(describeEvent(e, names)?.text).toBe("Home FC switch to 3-4-3, very attacking (D DEF→MID).");
  });

  test("the referee's big calls are reported", () => {
    const lines = commentary(
      [
        { ...at(600), side: "away", type: "card", playerId: "z", card: "second_yellow" },
        { ...at(700), side: "home", type: "set_piece", kind: "penalty", playerId: "a" },
        { ...at(800), side: "home", type: "offside", playerId: "b", passerId: "a" },
        { ...at(900), side: "away", type: "substitution", offId: "y", onId: "w" },
      ],
      names,
    );
    expect(lines.map((l) => l.text)).toEqual([
      "Second yellow! Z is sent off.",
      "Penalty to Home FC! A will take it.",
      "B is flagged offside.",
      "Away FC change: W on, Y off.",
    ]);
  });

  test("whistles and added time come from the match", () => {
    const events: MatchEvent[] = [
      { ...at(HALF_TIME), side: "home", type: "added_time", minutes: 2 },
      { ...at(HALF_TIME + 121), side: "home", type: "whistle", phase: "half_time" },
      { ...at(HALF_TIME, 2), side: "away", type: "kickoff" },
    ];
    expect(commentary(events, names).map((l) => l.text)).toEqual([
      "2 minutes added on.",
      "Half time.",
      "The second half begins.",
    ]);
  });

  test("minutes count up, with added time shown on top", () => {
    expect(minuteLabel(1, 0)).toBe("1'");
    expect(minuteLabel(1, 61)).toBe("2'");
    expect(minuteLabel(1, HALF_TIME)).toBe("45'");
    expect(minuteLabel(1, HALF_TIME + 61)).toBe("45+2'");
    expect(minuteLabel(2, HALF_TIME)).toBe("46'");
    expect(minuteLabel(2, 90 * 60 + 30)).toBe("90+1'");
  });
});

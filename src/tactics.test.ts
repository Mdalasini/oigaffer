import { expect, test } from "bun:test";
import type { Position } from "./model";
import { assignRoles, FORMATIONS, lineCount, moveSpot, pairedSpot, sameTactics, shapeName, shapeOf, type FormationName, type LineupPlayer, type Tactics } from "./tactics";
import { FOUR_FOUR_TWO, player } from "./test-helpers";

// A 4-4-2 where each player's attacking lean rises with their index inside a line
function fourFourTwo(): LineupPlayer[] {
  return FOUR_FOUR_TWO.map((role, i) => {
    const p = player(`p${i}`, role, 5 + i, 15 - i);
    return { id: p.id, role, attributes: p.attributes };
  });
}

const counts = (roles: Map<string, Position>) => {
  const c: Record<string, number> = {};
  for (const r of roles.values()) c[r] = (c[r] ?? 0) + 1;
  return c;
};

test("every formation has ten different outfield positions", () => {
  for (const f of Object.values(FORMATIONS)) {
    expect(new Set(f).size).toBe(10);
    expect(f).not.toContain("GK");
  }
});

test("formation names count the defenders, midfielders and forwards", () => {
  for (const name of Object.keys(FORMATIONS) as FormationName[]) {
    expect([lineCount(FORMATIONS[name], "DEF"), lineCount(FORMATIONS[name], "MID"), lineCount(FORMATIONS[name], "FWD")].join("-")).toBe(name);
  }
});

for (const name of Object.keys(FORMATIONS) as FormationName[]) {
  test(`${name} fills each line to size and keeps the keeper`, () => {
    const roles = assignRoles(fourFourTwo(), FORMATIONS[name]);
    expect(roles.get("p0")).toBe("GK");
    expect(counts(roles)).toMatchObject({ GK: 1, DEF: lineCount(FORMATIONS[name], "DEF"), MID: lineCount(FORMATIONS[name], "MID"), FWD: lineCount(FORMATIONS[name], "FWD") });
  });
}

test("keeping the same formation moves nobody", () => {
  const players = fourFourTwo();
  const roles = assignRoles(players, FORMATIONS["4-4-2"]);
  for (const p of players) expect(roles.get(p.id)).toBe(p.role);
});

test("4-4-2 to 3-4-3 moves the most attacking defender into midfield and the most attacking midfielder up front", () => {
  const players = fourFourTwo();
  const roles = assignRoles(players, FORMATIONS["3-4-3"]);
  const moved = players.filter((p) => roles.get(p.id) !== p.role).map((p) => `${p.id}:${p.role}->${roles.get(p.id)}`);
  // p4 is the most attacking defender, p8 the most attacking midfielder
  expect(moved.sort()).toEqual(["p4:DEF->MID", "p8:MID->FWD"]);
});

test("moving a position keeps the rest of the shape in order", () => {
  const t: Tactics = { formation: "4-4-2", mentality: 0 };
  const moved = moveSpot(t, "LM", "LW");
  expect(moved.shape).toEqual(FORMATIONS["4-4-2"].map((s) => (s === "LM" ? "LW" : s)));
  // Onto an occupied position, from one the shape doesn't use, or involving the keeper: nothing happens
  expect(moveSpot(t, "LM", "LB")).toBe(t);
  expect(moveSpot(t, "CAM", "LW")).toBe(t);
  expect(moveSpot(t, "LM", "GK")).toBe(t);
});

test("custom shapes are named row by row, presets by their own name", () => {
  expect(shapeName({ formation: "4-4-2", mentality: 0 })).toBe("4-4-2");
  // Back to a preset's positions in any order is that preset
  expect(shapeName({ formation: "4-4-2", mentality: 0, shape: [...FORMATIONS["4-3-3"]].reverse() })).toBe("4-3-3");
  const t: Tactics = { formation: "4-3-3", mentality: 0 };
  const fourTwoThreeOne = moveSpot(moveSpot(moveSpot(t, "LCM", "LDM"), "RCM", "RDM"), "CDM", "CAM");
  expect(shapeName(fourTwoThreeOne)).toBe("4-2-3-1");
  // Wing-backs count in the defence
  expect(shapeName(moveSpot({ formation: "5-3-2", mentality: 0 }, "CM", "CAM"))).toBe("5-2-1-2");
});

test("an out-of-possession shape pairs each position with one to drop to", () => {
  const t: Tactics = { formation: "4-3-3", mentality: 0 };
  expect(shapeOf(t, "out")).toEqual(shapeOf(t));
  const out = moveSpot(t, "LW", "LM", "out");
  expect(out.shape).toEqual(FORMATIONS["4-3-3"]);
  expect(shapeOf(out, "out")).toEqual(FORMATIONS["4-3-3"].map((s) => (s === "LW" ? "LM" : s)));
  expect(shapeName(out, "out")).toBe("4-1-3-1-1");
  expect(sameTactics(t, out)).toBe(false);
  // The same positions paired the other way round are different tactics
  const lwToLm = moveSpot(moveSpot(t, "LW", "LM", "out"), "RW", "RM", "out");
  const crossed = { ...lwToLm, outOfPossession: shapeOf(lwToLm, "out").map((s) => (s === "LM" ? "RM" : s === "RM" ? "LM" : s)) };
  expect(sameTactics(lwToLm, crossed)).toBe(false);
});

test("phases fall back on the shape with or without the ball until they get their own", () => {
  const t = moveSpot({ formation: "4-3-3", mentality: 0 }, "LW", "LM", "out");
  expect(shapeOf(t, "build_up")).toEqual(shapeOf(t));
  expect(shapeOf(t, "low_block")).toEqual(shapeOf(t, "out"));
  const lowBlock = moveSpot(t, "CF", "CAM", "low_block");
  expect(shapeOf(lowBlock, "low_block")).toContain("CAM");
  expect(shapeOf(lowBlock, "mid_block")).toEqual(shapeOf(t, "out"));
  expect(pairedSpot(lowBlock, "CF", "low_block")).toBe("CAM");
  expect(pairedSpot(lowBlock, "LW", "low_block")).toBe("LM");
  expect(sameTactics(t, lowBlock)).toBe(false);
  // A phase set on its own stays put when the shape it fell back on changes
  const moved = moveSpot(lowBlock, "LM", "LWB", "out");
  expect(pairedSpot(moved, "LW", "mid_block")).toBe("LWB");
  expect(pairedSpot(moved, "LW", "low_block")).toBe("LM");
});

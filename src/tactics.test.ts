import { expect, test } from "bun:test";
import type { Position } from "./model";
import { assignRoles, FORMATIONS, lineCount, type FormationName, type LineupPlayer } from "./tactics";
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
    expect([lineCount(name, "DEF"), lineCount(name, "MID"), lineCount(name, "FWD")].join("-")).toBe(name);
  }
});

for (const name of Object.keys(FORMATIONS) as FormationName[]) {
  test(`${name} fills each line to size and keeps the keeper`, () => {
    const roles = assignRoles(fourFourTwo(), name);
    expect(roles.get("p0")).toBe("GK");
    expect(counts(roles)).toMatchObject({ GK: 1, DEF: lineCount(name, "DEF"), MID: lineCount(name, "MID"), FWD: lineCount(name, "FWD") });
  });
}

test("keeping the same formation moves nobody", () => {
  const players = fourFourTwo();
  const roles = assignRoles(players, "4-4-2");
  for (const p of players) expect(roles.get(p.id)).toBe(p.role);
});

test("4-4-2 to 3-4-3 moves the most attacking defender into midfield and the most attacking midfielder up front", () => {
  const players = fourFourTwo();
  const roles = assignRoles(players, "3-4-3");
  const moved = players.filter((p) => roles.get(p.id) !== p.role).map((p) => `${p.id}:${p.role}->${roles.get(p.id)}`);
  // p4 is the most attacking defender, p8 the most attacking midfielder
  expect(moved.sort()).toEqual(["p4:DEF->MID", "p8:MID->FWD"]);
});

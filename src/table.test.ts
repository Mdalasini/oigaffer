import { expect, test } from "bun:test";
import { buildTable } from "./table";

test("records wins, draws and losses", () => {
  const table = buildTable(
    ["a", "b", "c"],
    [
      { homeId: "a", awayId: "b", homeGoals: 2, awayGoals: 0 },
      { homeId: "b", awayId: "c", homeGoals: 1, awayGoals: 1 },
      { homeId: "c", awayId: "a", homeGoals: 3, awayGoals: 1 },
    ],
  );
  const byId = Object.fromEntries(table.map((r) => [r.clubId, r]));
  expect(byId.a).toMatchObject({ played: 2, won: 1, lost: 1, goalsFor: 3, goalsAgainst: 3, points: 3 });
  expect(byId.b).toMatchObject({ played: 2, drawn: 1, lost: 1, goalDifference: -2, points: 1 });
  expect(byId.c).toMatchObject({ played: 2, won: 1, drawn: 1, goalDifference: 2, points: 4 });
});

test("sorts by points, then goal difference, then goals scored", () => {
  const table = buildTable(
    ["a", "b", "c", "d"],
    [
      { homeId: "a", awayId: "d", homeGoals: 1, awayGoals: 0 }, // a: 3pts, +1, 1 scored
      { homeId: "b", awayId: "d", homeGoals: 3, awayGoals: 2 }, // b: 3pts, +1, 3 scored
      { homeId: "c", awayId: "d", homeGoals: 4, awayGoals: 0 }, // c: 3pts, +4
    ],
  );
  expect(table.map((r) => r.clubId)).toEqual(["c", "b", "a", "d"]);
});

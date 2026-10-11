import { expect, test } from "bun:test";
import { seededRng } from "./random";
import { playSeason } from "./season";
import { generateWorld } from "./seed";

const NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];

test("seeded clubs field eleven players with valid attributes", () => {
  const world = generateWorld(NAMES, seededRng(1));
  for (const club of Object.values(world.clubs)) {
    expect(club.playerIds).toHaveLength(11);
    for (const id of club.playerIds) {
      const { attacking, defending } = world.players[id]!.attributes;
      for (const v of [attacking, defending]) {
        expect(Number.isInteger(v) && v >= 1 && v <= 20).toBe(true);
      }
    }
  }
});

test("every club plays everyone home and away and the table adds up", () => {
  const rng = seededRng(3);
  const world = generateWorld(NAMES, rng);
  const { results, table } = playSeason(world, rng);

  expect(results).toHaveLength(NAMES.length * (NAMES.length - 1));
  for (const row of table) {
    expect(row.played).toBe(2 * (NAMES.length - 1));
    expect(row.won + row.drawn + row.lost).toBe(row.played);
  }
  const goalsFor = table.reduce((s, r) => s + r.goalsFor, 0);
  const goalsAgainst = table.reduce((s, r) => s + r.goalsAgainst, 0);
  expect(goalsFor).toBe(goalsAgainst);
});

test("same seed replays the same season", () => {
  const run = () => {
    const rng = seededRng(99);
    return playSeason(generateWorld(NAMES, rng), rng).table;
  };
  expect(run()).toEqual(run());
});

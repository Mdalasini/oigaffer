import { expect, test } from "bun:test";
import type { GameWorld } from "./model";
import { pickEleven } from "./squad";
import { player, squad } from "./test-helpers";

function worldOf(players: ReturnType<typeof player>[]): GameWorld {
  return {
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    clubs: { c: { id: "c", name: "C", playerIds: players.map((p) => p.id) } },
  };
}

test("the best natural players start and the rest are on the bench", () => {
  const world = worldOf([...squad("a", 10, 10), player("star", "FWD", 18, 5), player("reserve", "GK", 1, 4)]);
  const eleven = pickEleven(world, world.clubs.c!);
  const ids = eleven.map((p) => p.id);
  expect(eleven).toHaveLength(11);
  expect(ids).toContain("star");
  expect(ids).not.toContain("reserve");
  expect(eleven.filter((p) => p.position === "GK")).toHaveLength(1);
});

test("the formation decides how many of each line start", () => {
  const extra = [player("f1", "FWD", 12, 5), player("f2", "FWD", 12, 5)];
  const world = worldOf([...squad("a", 10, 10), ...extra]);
  const eleven = pickEleven(world, world.clubs.c!, "4-3-3");
  expect(eleven.filter((p) => p.position === "FWD")).toHaveLength(3);
  expect(eleven.filter((p) => p.position === "MID")).toHaveLength(3);
});

test("gaps in a line are filled by whoever suits it best", () => {
  // Only one natural forward for a two-striker formation
  const players = squad("a", 10, 10).filter((p) => p.id !== "a10");
  const world = worldOf([...players, player("m", "MID", 15, 3)]);
  const eleven = pickEleven(world, world.clubs.c!);
  expect(eleven).toHaveLength(11);
  expect(eleven.map((p) => p.id)).toContain("m");
});

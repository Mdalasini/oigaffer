import { expect, test } from "bun:test";
import type { GameWorld, Player, Position } from "./model";
import { clubStrength } from "./strength";

const player = (id: string, position: Position, attacking: number, defending: number): Player => ({
  id,
  name: id,
  position,
  attributes: { attacking, defending },
});

function worldWith(players: Player[]): GameWorld {
  return {
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    clubs: { c1: { id: "c1", name: "Test FC", playerIds: players.map((p) => p.id) } },
  };
}

test("strong forwards raise attack, strong defenders raise defence", () => {
  const world = worldWith([
    player("gk", "GK", 1, 10),
    player("def", "DEF", 5, 18),
    player("mid", "MID", 12, 12),
    player("fwd", "FWD", 18, 4),
  ]);
  const { attack, defence } = clubStrength(world, world.clubs.c1!);

  // attack: (5*0.2 + 12*0.6 + 18*1) / 1.8
  expect(attack).toBeCloseTo(26.2 / 1.8);
  // defence: (10*1 + 18*1 + 12*0.6 + 4*0.2) / 2.8
  expect(defence).toBeCloseTo(36 / 2.8);
});

test("empty squad has zero strength", () => {
  const world = worldWith([]);
  expect(clubStrength(world, world.clubs.c1!)).toEqual({ attack: 0, defence: 0 });
});

import { describe, expect, test } from "bun:test";
import type { Player, Position } from "./model";
import { DEFAULT_CLUBS, generateWorld } from "./seed";
import { seededRng } from "./random";

const PHYSICALS = ["pace", "acceleration", "jumping", "strength"] as const;

const average = (players: Player[], attr: (typeof PHYSICALS)[number]) =>
  players.reduce((sum, p) => sum + p.attributes[attr], 0) / players.length;

describe("generateWorld physical attributes", () => {
  const world = generateWorld(DEFAULT_CLUBS, seededRng(7));
  const players = Object.values(world.players);
  const byPosition = (position: Position) => players.filter((p) => p.position === position);

  test("every player has all four physicals between 1 and 20", () => {
    for (const p of players) {
      for (const attr of PHYSICALS) {
        expect(p.attributes[attr]).toBeGreaterThanOrEqual(1);
        expect(p.attributes[attr]).toBeLessThanOrEqual(20);
      }
    }
  });

  test("physicals follow positional profiles on average", () => {
    expect(average(byPosition("FWD"), "pace")).toBeGreaterThan(average(byPosition("DEF"), "pace"));
    expect(average(byPosition("DEF"), "jumping")).toBeGreaterThan(average(byPosition("MID"), "jumping"));
    expect(average(byPosition("DEF"), "strength")).toBeGreaterThan(average(byPosition("MID"), "strength"));
  });

  test("the same seed gives the same world", () => {
    expect(generateWorld(DEFAULT_CLUBS, seededRng(7))).toEqual(world);
  });
});

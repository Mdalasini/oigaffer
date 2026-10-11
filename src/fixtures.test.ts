import { expect, test } from "bun:test";
import { doubleRoundRobin } from "./fixtures";

const clubs = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

for (const n of [2, 4, 7, 10, 20]) {
  test(`${n} clubs: every pair meets once home and once away`, () => {
    const ids = clubs(n);
    const rounds = doubleRoundRobin(ids);
    const slots = n % 2 === 0 ? n : n + 1;
    expect(rounds).toHaveLength(2 * (slots - 1));

    const meetings = new Map<string, number>();
    for (const round of rounds) {
      // Nobody plays twice in a round
      const playing = round.flatMap((f) => [f.homeId, f.awayId]);
      expect(new Set(playing).size).toBe(playing.length);
      for (const f of round) {
        const key = `${f.homeId}>${f.awayId}`;
        meetings.set(key, (meetings.get(key) ?? 0) + 1);
      }
    }

    expect(meetings.size).toBe(n * (n - 1));
    expect([...meetings.values()].every((c) => c === 1)).toBe(true);
  });
}

test("each club has an equal number of home games", () => {
  const ids = clubs(10);
  const home = new Map(ids.map((id) => [id, 0]));
  for (const round of doubleRoundRobin(ids)) {
    for (const f of round) home.set(f.homeId, home.get(f.homeId)! + 1);
  }
  expect([...home.values()].every((c) => c === 9)).toBe(true);
});

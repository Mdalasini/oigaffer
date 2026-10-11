import type { Id } from "./model";

export interface Fixture {
  homeId: Id;
  awayId: Id;
}

export type Round = Fixture[];

// Double round robin using the circle method: one club stays fixed while the
// rest rotate around it. The second half repeats the first with venues swapped.
// With an odd number of clubs, one club sits out each round.
export function doubleRoundRobin(clubIds: Id[]): Round[] {
  const slots: (Id | null)[] = [...clubIds];
  if (slots.length % 2 === 1) slots.push(null);
  const n = slots.length;

  const firstHalf: Round[] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: Round = [];
    for (let i = 0; i < n / 2; i++) {
      const a = slots[i];
      const b = slots[n - 1 - i];
      if (a == null || b == null) continue;
      // Alternate venues so no club is stuck at home or away for long runs
      const swap = i === 0 ? r % 2 === 1 : i % 2 === 1;
      round.push(swap ? { homeId: b, awayId: a } : { homeId: a, awayId: b });
    }
    firstHalf.push(round);
    // Keep slot 0 fixed, rotate the rest one place clockwise
    slots.splice(1, 0, slots.pop()!);
  }

  const secondHalf = firstHalf.map((round) =>
    round.map(({ homeId, awayId }) => ({ homeId: awayId, awayId: homeId })),
  );
  return [...firstHalf, ...secondHalf];
}

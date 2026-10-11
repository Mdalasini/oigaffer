import type { Id } from "./model";

export interface Result {
  homeId: Id;
  awayId: Id;
  homeGoals: number;
  awayGoals: number;
}

export interface TableRow {
  clubId: Id;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

const emptyRow = (clubId: Id): TableRow => ({
  clubId,
  played: 0,
  won: 0,
  drawn: 0,
  lost: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  goalDifference: 0,
  points: 0,
});

function record(row: TableRow, scored: number, conceded: number): void {
  row.played++;
  row.goalsFor += scored;
  row.goalsAgainst += conceded;
  row.goalDifference = row.goalsFor - row.goalsAgainst;
  if (scored > conceded) {
    row.won++;
    row.points += 3;
  } else if (scored === conceded) {
    row.drawn++;
    row.points += 1;
  } else {
    row.lost++;
  }
}

// Sorted by points, then goal difference, then goals scored
export function buildTable(clubIds: Id[], results: Result[]): TableRow[] {
  const rows = new Map(clubIds.map((id) => [id, emptyRow(id)]));
  const row = (id: Id) => {
    const r = rows.get(id);
    if (!r) throw new Error(`Result references unknown club ${id}`);
    return r;
  };
  for (const r of results) {
    record(row(r.homeId), r.homeGoals, r.awayGoals);
    record(row(r.awayId), r.awayGoals, r.homeGoals);
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.clubId.localeCompare(b.clubId),
  );
}

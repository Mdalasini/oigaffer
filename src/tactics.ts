import type { Attributes, Id, Position } from "./model";

// -2 very defensive … +2 very attacking
export type Mentality = -2 | -1 | 0 | 1 | 2;

export const MENTALITY_NAMES: Record<Mentality, string> = {
  [-2]: "very defensive",
  [-1]: "defensive",
  0: "balanced",
  1: "attacking",
  2: "very attacking",
};

// Outfield players per line; the keeper is implied
export const FORMATIONS = {
  "5-4-1": { DEF: 5, MID: 4, FWD: 1 },
  "5-3-2": { DEF: 5, MID: 3, FWD: 2 },
  "4-5-1": { DEF: 4, MID: 5, FWD: 1 },
  "4-4-2": { DEF: 4, MID: 4, FWD: 2 },
  "4-3-3": { DEF: 4, MID: 3, FWD: 3 },
  "3-4-3": { DEF: 3, MID: 4, FWD: 3 },
} as const satisfies Record<string, Record<Exclude<Position, "GK">, number>>;

export type FormationName = keyof typeof FORMATIONS;

export interface Tactics {
  formation: FormationName;
  mentality: Mentality;
}

const LINE_ORDER: Position[] = ["DEF", "MID", "FWD"];

// How much a player leans forward: positive for natural attackers
const attackingLean = (a: Attributes) => (a.shooting + a.dribbling) / 2 - a.tackling;

export interface LineupPlayer {
  id: Id;
  role: Position;
  attributes: Attributes;
}

// Fits the outfield players into a formation with as little reshuffling as possible:
// line them up from back to front (current line first, then attacking lean) and
// cut that queue into the new line sizes. Going 4-4-2 → 3-4-3 moves the most
// attacking defender into midfield and the most attacking midfielder up front.
export function assignRoles(players: LineupPlayer[], formation: FormationName): Map<Id, Position> {
  const roles = new Map<Id, Position>();
  const keeper =
    players.find((p) => p.role === "GK") ??
    players.reduce((a, b) => (b.attributes.goalkeeping > a.attributes.goalkeeping ? b : a));
  roles.set(keeper.id, "GK");

  const outfield = players
    .filter((p) => p !== keeper)
    .sort(
      (a, b) =>
        LINE_ORDER.indexOf(a.role) - LINE_ORDER.indexOf(b.role) ||
        attackingLean(a.attributes) - attackingLean(b.attributes),
    );

  let i = 0;
  for (const line of LINE_ORDER) {
    const count = FORMATIONS[formation][line as Exclude<Position, "GK">];
    for (let n = 0; n < count && i < outfield.length; n++) roles.set(outfield[i++]!.id, line);
  }
  // Short or long squads: anyone left over joins the front line
  while (i < outfield.length) roles.set(outfield[i++]!.id, "FWD");
  return roles;
}

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

// Every position on the tactics board. Rows run from the keeper (0) to the front line (5),
// columns from the left touchline (0) to the right (4), as seen attacking upwards.
// The line is how the engine treats whoever plays there: wing-backs defend like defenders,
// and wingers play off the last defender like forwards.
export const SPOTS = {
  GK: { row: 0, col: 2, line: "GK" },
  LB: { row: 1, col: 0, line: "DEF" },
  LCB: { row: 1, col: 1, line: "DEF" },
  CB: { row: 1, col: 2, line: "DEF" },
  RCB: { row: 1, col: 3, line: "DEF" },
  RB: { row: 1, col: 4, line: "DEF" },
  LWB: { row: 2, col: 0, line: "DEF" },
  LDM: { row: 2, col: 1, line: "MID" },
  CDM: { row: 2, col: 2, line: "MID" },
  RDM: { row: 2, col: 3, line: "MID" },
  RWB: { row: 2, col: 4, line: "DEF" },
  LM: { row: 3, col: 0, line: "MID" },
  LCM: { row: 3, col: 1, line: "MID" },
  CM: { row: 3, col: 2, line: "MID" },
  RCM: { row: 3, col: 3, line: "MID" },
  RM: { row: 3, col: 4, line: "MID" },
  LW: { row: 4, col: 0, line: "FWD" },
  LAM: { row: 4, col: 1, line: "MID" },
  CAM: { row: 4, col: 2, line: "MID" },
  RAM: { row: 4, col: 3, line: "MID" },
  RW: { row: 4, col: 4, line: "FWD" },
  LF: { row: 5, col: 1, line: "FWD" },
  CF: { row: 5, col: 2, line: "FWD" },
  RF: { row: 5, col: 3, line: "FWD" },
} as const satisfies Record<string, { row: number; col: number; line: Position }>;

export type Spot = keyof typeof SPOTS;

// The ten outfield positions of each formation; the keeper is implied
export const FORMATIONS = {
  "5-4-1": ["LWB", "LCB", "CB", "RCB", "RWB", "LM", "LCM", "RCM", "RM", "CF"],
  "5-3-2": ["LWB", "LCB", "CB", "RCB", "RWB", "LCM", "CM", "RCM", "LF", "RF"],
  "4-5-1": ["LB", "LCB", "RCB", "RB", "LM", "LCM", "CM", "RCM", "RM", "CF"],
  "4-4-2": ["LB", "LCB", "RCB", "RB", "LM", "LCM", "RCM", "RM", "LF", "RF"],
  "4-3-3": ["LB", "LCB", "RCB", "RB", "CDM", "LCM", "RCM", "LW", "CF", "RW"],
  "3-4-3": ["LCB", "CB", "RCB", "LM", "LCM", "RCM", "RM", "LW", "CF", "RW"],
} as const satisfies Record<string, readonly Spot[]>;

export type FormationName = keyof typeof FORMATIONS;

// How many players a formation puts in a line
export const lineCount = (formation: FormationName, line: Position): number =>
  line === "GK" ? 1 : FORMATIONS[formation].filter((s) => SPOTS[s].line === line).length;

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
    const count = lineCount(formation, line);
    for (let n = 0; n < count && i < outfield.length; n++) roles.set(outfield[i++]!.id, line);
  }
  // Short or long squads: anyone left over joins the front line
  while (i < outfield.length) roles.set(outfield[i++]!.id, "FWD");
  return roles;
}

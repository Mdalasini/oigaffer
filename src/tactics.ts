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

// The ten outfield positions a side plays
export type Shape = readonly Spot[];

// How many players a shape puts in a line
export const lineCount = (shape: Shape, line: Position): number =>
  line === "GK" ? 1 : shape.filter((s) => SPOTS[s].line === line).length;

export interface Tactics {
  formation: FormationName;
  mentality: Mentality;
  // The manager's own rearrangement of the formation, if they've moved positions on the board
  shape?: Shape;
}

export const shapeOf = (t: Tactics): Shape => t.shape ?? FORMATIONS[t.formation];

const sameSpots = (a: Shape, b: Shape) => a.length === b.length && a.every((s) => b.includes(s));

export const sameTactics = (a: Tactics, b: Tactics): boolean =>
  a.formation === b.formation && a.mentality === b.mentality && sameSpots(shapeOf(a), shapeOf(b));

// A preset's own name, or a custom shape counted row by row from the back the way managers name them
// (4-2-3-1), with wing-backs counted in the defence
export function shapeName(t: Tactics): string {
  const shape = shapeOf(t);
  const preset = (Object.keys(FORMATIONS) as FormationName[]).find((f) => sameSpots(FORMATIONS[f], shape));
  if (preset) return preset;
  const rows = [0, 0, 0, 0, 0];
  for (const s of shape) {
    const { row, line } = SPOTS[s];
    rows[line === "DEF" ? 0 : row - 1]!++;
  }
  return rows.filter((n) => n > 0).join("-");
}

// Moves a position on the board, keeping the player who was there: LM up to LW, say.
// The keeper stays in goal.
export function moveSpot(t: Tactics, from: Spot, to: Spot): Tactics {
  const shape = shapeOf(t);
  if (from === "GK" || to === "GK" || !shape.includes(from) || shape.includes(to)) return t;
  return { ...t, shape: shape.map((s) => (s === from ? to : s)) };
}

const LINE_ORDER: Position[] = ["DEF", "MID", "FWD"];

// How much a player leans forward: positive for natural attackers
const attackingLean = (a: Attributes) => (a.shooting + a.dribbling) / 2 - a.tackling;

export interface LineupPlayer {
  id: Id;
  role: Position;
  attributes: Attributes;
}

// Fits the outfield players into a shape with as little reshuffling as possible:
// line them up from back to front (current line first, then attacking lean) and
// cut that queue into the new line sizes. Going 4-4-2 → 3-4-3 moves the most
// attacking defender into midfield and the most attacking midfielder up front.
export function assignRoles(players: LineupPlayer[], shape: Shape): Map<Id, Position> {
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
    const count = lineCount(shape, line);
    for (let n = 0; n < count && i < outfield.length; n++) roles.set(outfield[i++]!.id, line);
  }
  // Short or long squads: anyone left over joins the front line
  while (i < outfield.length) roles.set(outfield[i++]!.id, "FWD");
  return roles;
}

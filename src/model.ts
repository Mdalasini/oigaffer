export type Id = string;

export type Position = "GK" | "DEF" | "MID" | "FWD";

// 1–20, like FM
export interface Attributes {
  passing: number;
  shooting: number;
  dribbling: number;
  tackling: number;
  goalkeeping: number;
  stamina: number; // how slowly they tire over a match
}

export interface Player {
  id: Id;
  name: string;
  position: Position;
  attributes: Attributes;
}

export interface Club {
  id: Id;
  name: string;
  playerIds: Id[]; // the whole squad; the starting eleven is picked from it
}

export interface GameWorld {
  clubs: Record<Id, Club>;
  players: Record<Id, Player>;
}

export type Id = string;

export type Position = "GK" | "DEF" | "MID" | "FWD";

// 1–20, like FM
export interface Attributes {
  attacking: number;
  defending: number;
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
  playerIds: Id[];
}

export interface GameWorld {
  clubs: Record<Id, Club>;
  players: Record<Id, Player>;
}

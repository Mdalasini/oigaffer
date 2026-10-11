import type { Manager } from "../manager";
import type { Attributes, Id, Position } from "../model";
import type { ClubStrength } from "../strength";
import type { FormationName, Mentality, Tactics } from "../tactics";
import { CONTROL_TICKS } from "./constants";
import type { Rng } from "../random";
import { dist, PITCH_LENGTH, PITCH_WIDTH, type Vec } from "./geometry";

export type Side = "home" | "away";

export const opponent = (side: Side): Side => (side === "home" ? "away" : "home");

export interface MatchPlayer {
  id: Id;
  side: Side;
  position: Position; // the role they're playing in the current formation
  attributes: Attributes;
  slot: Vec; // formation position in the team frame
  pos: Vec; // world position
  cooldown: number; // ticks before this player can challenge again
}

export interface Ball {
  pos: Vec;
  ownerId: Id | null;
  lastSide: Side; // team that last had possession
  readyAt: number; // tick from which the owner can act
  runnerId: Id | null; // player a through ball was played for
}

export type ShotOutcome = "goal" | "saved" | "off_target" | "blocked";

export type MatchEvent = { time: number; side: Side } & (
  | { type: "kickoff" }
  | { type: "pass"; playerId: Id; receiverId: Id }
  | { type: "through_ball"; playerId: Id; receiverId: Id }
  | { type: "interception"; playerId: Id; interceptorId: Id }
  | { type: "pass_astray"; playerId: Id }
  | { type: "dribble"; playerId: Id; defenderId: Id | null }
  | { type: "tackle"; playerId: Id; carrierId: Id; won: boolean }
  | { type: "clearance"; playerId: Id }
  | { type: "shot"; playerId: Id; xg: number; outcome: ShotOutcome; keeperId?: Id }
  | { type: "recovery"; playerId: Id }
  | { type: "tactics"; formation: FormationName; mentality: Mentality; moved: { playerId: Id; from: Position; to: Position }[] }
);

export interface TeamState {
  tactics: Tactics;
  manager: Manager;
  strength: ClubStrength;
}

export interface MatchState {
  time: number;
  players: MatchPlayer[];
  ball: Ball;
  score: Record<Side, number>;
  xg: Record<Side, number>;
  teams: Record<Side, TeamState>;
  events: MatchEvent[];
  rng: Rng;
}

// Each team sees the pitch as attacking towards x = PITCH_LENGTH.
// The away team's frame is the world rotated 180°, so the conversion is its own inverse.
export function toTeamFrame(side: Side, v: Vec): Vec {
  return side === "home" ? { ...v } : { x: PITCH_LENGTH - v.x, y: PITCH_WIDTH - v.y };
}
export const fromTeamFrame = toTeamFrame;

export const attackingGoal = (side: Side): Vec => toTeamFrame(side, { x: PITCH_LENGTH, y: PITCH_WIDTH / 2 });
export const ownGoal = (side: Side): Vec => toTeamFrame(side, { x: 0, y: PITCH_WIDTH / 2 });

// ---------- Queries the AI uses to sense the world ----------

export const owner = (state: MatchState): MatchPlayer | undefined =>
  state.ball.ownerId === null ? undefined : state.players.find((p) => p.id === state.ball.ownerId);

export const teammates = (state: MatchState, p: MatchPlayer): MatchPlayer[] =>
  state.players.filter((o) => o.side === p.side && o.id !== p.id);

export const opponents = (state: MatchState, p: MatchPlayer): MatchPlayer[] =>
  state.players.filter((o) => o.side !== p.side);

export const keeperOf = (state: MatchState, side: Side): MatchPlayer | undefined =>
  state.players.find((p) => p.side === side && p.position === "GK");

export function nearest(players: MatchPlayer[], to: Vec): MatchPlayer | undefined {
  let best: MatchPlayer | undefined;
  let bestDist = Infinity;
  for (const p of players) {
    const d = dist(p.pos, to);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

// A keeper's "tackling" is how well they deal with players running at them
export const challengeSkill = (p: MatchPlayer): number =>
  p.position === "GK" ? p.attributes.goalkeeping : p.attributes.tackling;

// ---------- State changes ----------

export function emit(state: MatchState, event: DistributiveOmit<MatchEvent, "time">): void {
  state.events.push({ ...event, time: state.time } as MatchEvent);
}

export function giveBall(state: MatchState, p: MatchPlayer, controlTicks = CONTROL_TICKS): void {
  state.ball.ownerId = p.id;
  state.ball.lastSide = p.side;
  state.ball.pos = { ...p.pos };
  state.ball.readyAt = state.time + controlTicks;
  state.ball.runnerId = null;
}

export function looseBall(state: MatchState, pos: Vec, runnerId: Id | null = null): void {
  state.ball.ownerId = null;
  state.ball.pos = { ...pos };
  state.ball.runnerId = runnerId;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

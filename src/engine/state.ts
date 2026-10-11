import type { Manager } from "../manager";
import type { Attributes, Id, Position } from "../model";
import type { ClubStrength } from "../strength";
import type { FormationName, Mentality, Tactics } from "../tactics";
import { CONTROL_RADIUS, CONTROL_TICKS } from "./constants";
import type { Rng } from "../random";
import { dist, PITCH_LENGTH, PITCH_WIDTH, type Vec } from "./geometry";

export type Side = "home" | "away";

export const opponent = (side: Side): Side => (side === "home" ? "away" : "home");

export interface MatchPlayer {
  id: Id;
  side: Side;
  position: Position; // the role they're playing in the current formation
  natural: Position; // where they normally play
  base: Attributes; // fresh attributes
  attributes: Attributes; // current attributes, lowered by fatigue
  energy: number; // 1 fresh … 0 exhausted
  slot: Vec; // formation position in the team frame
  pos: Vec; // world position
  cooldown: number; // ticks before this player can challenge again
  yellow: boolean;
}

// Players not on the pitch: the bench, and anyone who has gone off
export interface OffPitch {
  id: Id;
  side: Side;
  natural: Position;
  attributes: Attributes;
  reason: "bench" | "substituted" | "sent_off" | "injured";
}

export type SetPiece = "kickoff" | "throw_in" | "goal_kick" | "corner" | "free_kick" | "indirect_free_kick" | "penalty";

export type FlightKind = "pass" | "driven" | "through" | "cross" | "shot" | "clearance";

export type EventPayload = DistributiveOmit<MatchEvent, "time" | "period" | "clock">;

// Outcomes are rolled at launch, except a header struck when the cross arrives.
export type Arrival =
  | { type: "receive"; playerId: Id; controlTicks: number }
  | { type: "loose"; side: Side; runnerId: Id | null }
  | { type: "offside"; side: Side }
  | { type: "goal"; side: Side }
  | { type: "goal_kick"; side: Side }
  | { type: "corner"; side: Side }
  | { type: "header"; playerId: Id; xg: number }
  | { type: "follow_on"; kind: FlightKind; destination: Vec; arrival: Arrival };

// Public renderer data. Sample at a fractional tick with sampleFlight().
export interface BallFlight {
  kind: FlightKind;
  origin: Vec;
  destination: Vec;
  launchTick: number;
  arrivalTick: number;
  peakHeight: number; // metres above the interpolated endpoint heights
  launchHeight: number;
  arrivalHeight: number;
  meetIds: Id[]; // players moving to the landing point
  penalty: boolean; // the period cannot end before this flight arrives
  arrival: Arrival;
  events: EventPayload[];
}

export interface Ball {
  pos: Vec;
  height: number; // metres above the pitch
  flight: BallFlight | null;
  ownerId: Id | null;
  lastSide: Side; // team that last had possession
  lastTouch: Side; // team that last touched it, for deciding restarts
  readyAt: number; // tick from which the owner can act
  runnerId: Id | null; // player a through ball was played for
  setPiece: SetPiece | null; // the restart about to be taken; limits what the taker can do
}

export interface Referee {
  strictness: number; // scales fouls given and cards shown
  pos: Vec;
}

export type ShotOutcome = "goal" | "saved" | "off_target" | "blocked";
export type ShotKind = "open_play" | "header" | "free_kick" | "penalty";
export type Card = "yellow" | "second_yellow" | "red";
export type Period = 1 | 2;
export type Phase = "first_half" | "half_time" | "second_half" | "full_time" | "abandoned";

export type MatchEvent = { time: number; period: Period; clock: number; side: Side } & (
  | { type: "kickoff" }
  | { type: "pass"; playerId: Id; receiverId: Id }
  | { type: "through_ball"; playerId: Id; receiverId: Id }
  | { type: "interception"; playerId: Id; interceptorId: Id }
  | { type: "pass_astray"; playerId: Id }
  | { type: "dribble"; playerId: Id; defenderId: Id | null }
  | { type: "tackle"; playerId: Id; carrierId: Id; won: boolean }
  | { type: "clearance"; playerId: Id }
  | { type: "shot"; playerId: Id; xg: number; outcome: ShotOutcome; keeperId?: Id; kind: ShotKind }
  | { type: "recovery"; playerId: Id }
  | { type: "tactics"; formation: FormationName; mentality: Mentality; moved: { playerId: Id; from: Position; to: Position }[] }
  // side: the team that crossed
  | { type: "cross"; playerId: Id; targetId: Id; outcome: "blocked" | "overhit" | "claimed" | "cleared" | "won" }
  // side: the team that committed it
  | { type: "foul"; playerId: Id; victimId: Id; award: "free_kick" | "penalty" | "advantage" }
  | { type: "card"; playerId: Id; card: Card }
  // side: the attacking team caught offside
  | { type: "offside"; playerId: Id; passerId: Id }
  // side: the team taking it
  | { type: "set_piece"; kind: Exclude<SetPiece, "kickoff">; playerId: Id }
  | { type: "substitution"; offId: Id; onId: Id }
  | { type: "injury"; playerId: Id }
  | { type: "added_time"; minutes: number }
  | { type: "whistle"; phase: "half_time" | "full_time" | "abandoned" }
);

export interface TeamState {
  tactics: Tactics;
  manager: Manager;
  strength: ClubStrength;
  subsUsed: number;
  pendingSubs: { offId: Id; onId: Id }[]; // made at the next stoppage
}

export interface MatchState {
  time: number; // ticks since kickoff, including stoppages
  period: Period;
  clock: number; // match clock in seconds: 0–2700 first half, 2700–5400 second, beyond for added time
  periodEnd: number; // clock at which the ref blows for this period; set once added time is known
  stoppage: number; // seconds to add on in the current period
  announcedStoppage: number; // stoppage total when added time was announced
  announcedEnd: number; // minimum period end shown by the fourth official
  phase: Phase;
  players: MatchPlayer[]; // on the pitch
  offPitch: OffPitch[];
  ball: Ball;
  referee: Referee;
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

// The ball is dead while a restart is being set up
export function ballDead(state: MatchState): boolean {
  if (state.ball.setPiece === null) return false;
  const taker = owner(state);
  return state.time < state.ball.readyAt || !taker || dist(taker.pos, state.ball.pos) > CONTROL_RADIUS;
}

// ---------- State changes ----------

export function emit(state: MatchState, event: DistributiveOmit<MatchEvent, "time" | "period" | "clock">): void {
  state.events.push({ ...event, time: state.time, period: state.period, clock: state.clock } as MatchEvent);
}

export function giveBall(state: MatchState, p: MatchPlayer, controlTicks = CONTROL_TICKS, setPiece: SetPiece | null = null): void {
  state.ball.flight = null;
  state.ball.height = 0;
  state.ball.ownerId = p.id;
  state.ball.lastSide = p.side;
  state.ball.lastTouch = p.side;
  state.ball.pos = { ...p.pos };
  state.ball.readyAt = state.time + controlTicks;
  state.ball.runnerId = null;
  state.ball.setPiece = setPiece;
}

export function looseBall(state: MatchState, pos: Vec, runnerId: Id | null = null): void {
  state.ball.flight = null;
  state.ball.height = 0;
  state.ball.ownerId = null;
  state.ball.pos = { ...pos };
  state.ball.runnerId = runnerId;
  state.ball.setPiece = null;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

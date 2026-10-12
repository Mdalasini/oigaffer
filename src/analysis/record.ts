import { isFullTime, startEventMatch, stepEventMatch, type Managers } from "../engine/match";
import { ballDead, toTeamFrame, type BallFlight, type FlightKind, type MatchEvent, type MatchState, type ShotOutcome, type Side } from "../engine/state";
import type { Vec } from "../engine/geometry";
import type { Club, GameWorld, Id, Position } from "../model";
import type { Rng } from "../random";

// A match recording: what an analyst would have without watching the game.
// The recorder only reads match state, so a recorded match plays out exactly like an
// unrecorded one. Every position is in the player's own team frame (attacking towards
// x = 105), so home and away players can be pooled.

// Whose ball it is from a team's point of view. A pass or cross in flight still
// belongs to the team that played it; a clearance or shot in flight belongs to nobody.
export type TeamPhase = "attack" | "defend" | "loose";

// One player, one second
export interface Frame {
  id: Id;
  side: Side;
  tick: number;
  clock: number;
  pos: Vec;
  slot: Vec; // formation anchor the player is working from
  speed: number; // m/s
  role: Position; // role in the current formation
  phase: TeamPhase;
  dead: boolean; // a restart is being set up
  onBall: boolean;
}

// The start of a spell on the ball
export interface Touch {
  id: Id;
  side: Side;
  tick: number;
  pos: Vec;
  phase: "open_play" | "restart";
}

// Every time a player strikes the ball: passes, crosses, shots and clearances
export interface Strike {
  id: Id;
  side: Side;
  tick: number;
  flight: FlightKind;
  // What was rolled at the strike. An interception still counts as the passer's strike.
  type: "pass" | "through_ball" | "interception" | "pass_astray" | "offside" | "cross" | "shot" | "clearance";
  receiverId: Id | null; // intended target, for passes and crosses
  outcome: ShotOutcome | "blocked" | "overhit" | "claimed" | "cleared" | "won" | null; // shots and crosses
  from: Vec;
  to: Vec;
  // Did the striker's team have the next player to control the ball? Null until someone does.
  kept: boolean | null;
}

export interface Recording {
  frames: Frame[];
  touches: Touch[];
  strikes: Strike[];
  events: MatchEvent[];
  score: Record<Side, number>;
  roles: Record<Id, Position>; // natural positions of everyone who played
}

function teamPhase(state: MatchState, side: Side): TeamPhase {
  const { ball } = state;
  let holder: Side | null = null;
  if (ball.ownerId !== null) holder = state.players.find((p) => p.id === ball.ownerId)?.side ?? null;
  else if (ball.flight && ball.flight.kind !== "clearance" && ball.flight.kind !== "shot") holder = ball.lastSide;
  if (holder === null) return "loose";
  return holder === side ? "attack" : "defend";
}

// A deflection or a follow-on flight has no striker and isn't recorded
function strikeFrom(state: MatchState): Strike | null {
  const flight = state.ball.flight!;
  const event = flight.events[0];
  if (!event) return null;
  let id: Id;
  let receiverId: Id | null = null;
  let outcome: Strike["outcome"] = null;
  switch (event.type) {
    case "pass":
    case "through_ball":
      id = event.playerId;
      receiverId = event.receiverId;
      break;
    case "interception":
    case "pass_astray":
    case "clearance":
      id = event.playerId;
      break;
    case "offside":
      id = event.passerId;
      receiverId = event.playerId;
      break;
    case "cross":
      id = event.playerId;
      receiverId = event.targetId;
      outcome = event.outcome;
      break;
    case "shot":
      id = event.playerId;
      outcome = event.outcome;
      break;
    default:
      return null;
  }
  const striker = state.players.find((p) => p.id === id);
  if (!striker) return null;
  const side = striker.side;
  return {
    id, side, tick: state.time, flight: flight.kind, type: event.type, receiverId, outcome,
    from: toTeamFrame(side, flight.origin), to: toTeamFrame(side, flight.destination), kept: null,
  };
}

export interface Recorder {
  recording: Recording;
  // Call after every stepEventMatch
  record(state: MatchState): void;
}

export function createRecorder(state: MatchState): Recorder {
  const recording: Recording = { frames: [], touches: [], strikes: [], events: state.events, score: state.score, roles: {} };
  let lastFlight: BallFlight | null = null;
  let lastOwner: Id | null = null;
  const unresolved: Strike[] = [];

  const record = (state: MatchState): void => {
    if (state.phase === "half_time" || isFullTime(state)) return;
    const { ball } = state;
    const dead = ballDead(state);
    const phase = { home: teamPhase(state, "home"), away: teamPhase(state, "away") };

    for (const p of state.players) {
      recording.roles[p.id] ??= p.natural;
      recording.frames.push({
        id: p.id, side: p.side, tick: state.time, clock: state.clock,
        pos: toTeamFrame(p.side, p.pos), slot: { ...p.slot },
        speed: Math.hypot(p.vel.x, p.vel.y), role: p.position, phase: phase[p.side], dead, onBall: ball.ownerId === p.id,
      });
    }

    if (ball.flight && ball.flight !== lastFlight) {
      const strike = strikeFrom(state);
      if (strike) {
        recording.strikes.push(strike);
        unresolved.push(strike);
      }
    }
    lastFlight = ball.flight;

    const carrier = ball.ownerId === null ? undefined : state.players.find((p) => p.id === ball.ownerId);
    if (carrier && carrier.id !== lastOwner) {
      recording.touches.push({
        id: carrier.id, side: carrier.side, tick: state.time, pos: toTeamFrame(carrier.side, carrier.pos),
        phase: ball.setPiece === null ? "open_play" : "restart",
      });
      for (const strike of unresolved) strike.kept = strike.side === carrier.side;
      unresolved.length = 0;
    }
    lastOwner = ball.ownerId;
  };

  return { recording, record };
}

// Plays one event-engine match, exactly as simulateEventMatch would, and records it.
export function recordMatch(world: GameWorld, home: Club, away: Club, rng: Rng, managers: Managers = {}): Recording {
  const state = startEventMatch(world, home, away, rng, managers);
  const recorder = createRecorder(state);
  while (!isFullTime(state)) {
    stepEventMatch(state);
    recorder.record(state);
  }
  return { ...recorder.recording, score: { ...state.score } };
}

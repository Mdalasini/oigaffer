import type { Id } from "../model";
import { ADDED, BALL_PEAK, BALL_SPEED, CONTROL_RADIUS, GOAL_CELEBRATION_TICKS, MIN_FLIGHT_TICKS } from "./constants";
import { kickoff } from "./formation";
import { CENTRE, dist, PITCH_LENGTH, PITCH_WIDTH, type Vec } from "./geometry";
import { resolveShot } from "./resolve";
import { awardFreeKick, corner, goalKick, placeBall } from "./restarts";
import { emit, giveBall, looseBall, opponent, toTeamFrame, type Arrival, type BallFlight, type EventPayload, type FlightKind, type MatchState } from "./state";

// No random draws here: resolution has already rolled and captured the outcome.
export function launchFlight(
  state: MatchState,
  kind: FlightKind,
  destination: Vec,
  arrival: Arrival,
  meetIds: Id[] = [],
  arrivalHeight = 0,
  events: EventPayload[] = [],
): void {
  const origin = { ...state.ball.pos };
  const duration = Math.max(MIN_FLIGHT_TICKS, Math.ceil(dist(origin, destination) / BALL_SPEED[kind]));
  state.ball.flight = {
    kind, origin, destination: { ...destination }, launchTick: state.time,
    arrivalTick: state.time + duration, peakHeight: BALL_PEAK[kind],
    launchHeight: state.ball.height, arrivalHeight, meetIds,
    penalty: state.ball.setPiece === "penalty", arrival, events,
  };
  state.ball.ownerId = null;
  state.ball.runnerId = null;
  state.ball.setPiece = null;
}

// A renderer can use state.time + interpolationFraction without changing the simulation.
export function sampleFlight(flight: BallFlight, tick: number): { pos: Vec; height: number } {
  const t = Math.max(0, Math.min(1, (tick - flight.launchTick) / (flight.arrivalTick - flight.launchTick)));
  return {
    pos: {
      x: flight.origin.x + (flight.destination.x - flight.origin.x) * t,
      y: flight.origin.y + (flight.destination.y - flight.origin.y) * t,
    },
    height: flight.launchHeight * (1 - t) + flight.arrivalHeight * t + 4 * flight.peakHeight * t * (1 - t),
  };
}

function land(state: MatchState, flight: BallFlight): void {
  const arrival = flight.arrival;
  const player = "playerId" in arrival ? state.players.find((p) => p.id === arrival.playerId) : undefined;
  const reached = !!player && dist(player.pos, state.ball.pos) <= CONTROL_RADIUS;
  for (const event of flight.events) {
    // A rolled completion is not a completed pass until the player controls it.
    if (!reached && arrival.type === "receive" && (event.type === "pass" || event.type === "interception")) continue;
    if (event.type === "shot") state.xg[event.side] += event.xg;
    emit(state, event);
  }
  switch (arrival.type) {
    case "receive":
      if (reached) giveBall(state, player!, arrival.controlTicks);
      else looseBall(state, state.ball.pos, arrival.playerId);
      break;
    case "loose":
      placeBall(state, state.ball.pos, arrival.side, arrival.runnerId);
      break;
    case "offside":
      awardFreeKick(state, opponent(arrival.side), state.ball.pos, false);
      break;
    case "goal":
      state.score[arrival.side]++;
      state.stoppage += ADDED.goal;
      kickoff(state, opponent(arrival.side), GOAL_CELEBRATION_TICKS);
      break;
    case "goal_kick":
      goalKick(state, arrival.side);
      break;
    case "corner":
      corner(state, arrival.side, toTeamFrame(arrival.side, {
        x: PITCH_LENGTH, y: toTeamFrame(arrival.side, state.ball.pos).y < CENTRE.y ? 0 : PITCH_WIDTH,
      }));
      break;
    case "header":
      // Only a player who got there can head it; otherwise it drops loose
      if (reached) resolveShot(state, player!, arrival.xg, "header");
      else looseBall(state, state.ball.pos, arrival.playerId);
      break;
    case "follow_on":
      launchFlight(state, arrival.kind, arrival.destination, arrival.arrival);
      break;
  }
}

// Called after movement, so a receiver gets the final second to reach the landing spot.
export function advanceFlight(state: MatchState): void {
  const flight = state.ball.flight;
  if (!flight) return;
  const sample = sampleFlight(flight, state.time);
  state.ball.pos = sample.pos;
  state.ball.height = sample.height;
  if (state.time < flight.arrivalTick) return;
  state.ball.flight = null;
  land(state, flight);
  if (!state.ball.flight) state.ball.height = 0;
}

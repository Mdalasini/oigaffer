import { defaultManager, type Manager } from "../manager";
import type { MatchResult } from "../match";
import type { Club, GameWorld } from "../model";
import type { Rng } from "../random";
import { pickEleven } from "../squad";
import { clubStrength } from "../strength";
import { assignRoles, type Tactics } from "../tactics";
import { HALF_TIME, MANAGER_INTERVAL, MATCH_SECONDS } from "./constants";
import { chooseAction } from "./decide";
import { arrangeSide, kickoff } from "./formation";
import { PITCH_LENGTH, PITCH_WIDTH } from "./geometry";
import { moveOffBall, pickUpLooseBall } from "./movement";
import { act, attemptTackle } from "./resolve";
import {
  emit,
  fromTeamFrame,
  opponent,
  owner,
  type MatchEvent,
  type MatchPlayer,
  type MatchState,
  type Side,
} from "./state";

export interface EventMatchResult extends MatchResult {
  events: MatchEvent[];
}

export type Managers = Partial<Record<Side, Manager>>;

export function createMatchState(
  world: GameWorld,
  home: Club,
  away: Club,
  rng: Rng,
  managers: Managers = {},
): MatchState {
  const clubs = { home, away };
  const strength = { home: clubStrength(world, home), away: clubStrength(world, away) };

  const players: MatchPlayer[] = [];
  for (const side of ["home", "away"] as const) {
    pickEleven(world, clubs[side]).forEach((p, i) => {
      players.push({
        id: p.id,
        side,
        position: p.position, // natural position until the manager picks the lineup
        attributes: p.attributes,
        slot: { x: 0, y: i }, // placeholder ordering; arrangeSide sets the real slot
        pos: { x: 0, y: 0 },
        cooldown: 0,
      });
    });
  }

  const team = (side: Side) => {
    const manager = managers[side] ?? defaultManager;
    const tactics = manager.prematch({ strength: strength[side], opponentStrength: strength[opponent(side)] });
    return { manager, tactics, strength: strength[side] };
  };

  const state: MatchState = {
    time: 0,
    players,
    ball: { pos: { x: PITCH_LENGTH / 2, y: PITCH_WIDTH / 2 }, ownerId: null, lastSide: "home", readyAt: 0, runnerId: null },
    score: { home: 0, away: 0 },
    xg: { home: 0, away: 0 },
    teams: { home: team("home"), away: team("away") },
    events: [],
    rng,
  };

  for (const side of ["home", "away"] as const) {
    applyTactics(state, side, state.teams[side].tactics, true);
    for (const p of players) if (p.side === side) p.pos = fromTeamFrame(side, p.slot);
  }
  return state;
}

// Switches a side to new tactics, moving players between lines if the formation changed
export function applyTactics(state: MatchState, side: Side, tactics: Tactics, force = false): void {
  const current = state.teams[side].tactics;
  if (!force && current.formation === tactics.formation && current.mentality === tactics.mentality) return;

  const team = state.players.filter((p) => p.side === side);
  const roles = assignRoles(
    team.map((p) => ({ id: p.id, role: p.position, attributes: p.attributes })),
    tactics.formation,
  );
  const moved: { playerId: string; from: MatchPlayer["position"]; to: MatchPlayer["position"] }[] = [];
  for (const p of team) {
    const role = roles.get(p.id)!;
    if (role !== p.position) moved.push({ playerId: p.id, from: p.position, to: role });
    p.position = role;
  }
  arrangeSide(state, side);
  state.teams[side].tactics = tactics;
  emit(state, { type: "tactics", side, formation: tactics.formation, mentality: tactics.mentality, moved });
}

function consultManagers(state: MatchState): void {
  for (const side of ["home", "away"] as const) {
    const team = state.teams[side];
    const decision = team.manager.inMatch({
      minute: Math.floor(state.time / 60),
      goalsFor: state.score[side],
      goalsAgainst: state.score[opponent(side)],
      strength: team.strength,
      opponentStrength: state.teams[opponent(side)].strength,
      tactics: team.tactics,
    });
    applyTactics(state, side, decision);
  }
}

// One second of play: the carrier may be challenged, then (once they've
// controlled the ball) decides and acts;
// everyone else moves; a loose ball goes to whoever reaches it.
export function tick(state: MatchState): void {
  for (const p of state.players) if (p.cooldown > 0) p.cooldown--;

  const carrier = owner(state);
  if (carrier && !attemptTackle(state, carrier) && state.time >= state.ball.readyAt) {
    act(state, carrier, chooseAction(state, carrier));
  }

  moveOffBall(state);
  if (state.ball.ownerId === null) pickUpLooseBall(state);
}

// Sets up a match ready for the first tick
export function startEventMatch(
  world: GameWorld,
  home: Club,
  away: Club,
  rng: Rng = Math.random,
  managers: Managers = {},
): MatchState {
  const state = createMatchState(world, home, away, rng, managers);
  kickoff(state, "home");
  return state;
}

export const isFullTime = (state: MatchState): boolean => state.time >= MATCH_SECONDS;

// Advances the match by one second. Managers look at the game every few
// minutes, and straight after a goal.
export function stepEventMatch(state: MatchState): void {
  if (isFullTime(state)) return;
  const t = ++state.time;
  if (t === HALF_TIME + 1) kickoff(state, "away");
  if (t % MANAGER_INTERVAL === 0 || scoredLastTick(state)) consultManagers(state);
  tick(state);
}

function scoredLastTick(state: MatchState): boolean {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i]!;
    if (e.time < state.time - 1) return false;
    if (e.type === "shot" && e.outcome === "goal" && e.time === state.time - 1) return true;
  }
  return false;
}

export function simulateEventMatch(
  world: GameWorld,
  home: Club,
  away: Club,
  rng: Rng = Math.random,
  managers: Managers = {},
): EventMatchResult {
  const state = startEventMatch(world, home, away, rng, managers);
  while (!isFullTime(state)) stepEventMatch(state);
  return {
    homeGoals: state.score.home,
    awayGoals: state.score.away,
    homeXg: state.xg.home,
    awayXg: state.xg.away,
    events: state.events,
  };
}

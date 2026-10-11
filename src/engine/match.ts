import { defaultManager, type Manager, type ManagerContext } from "../manager";
import type { MatchResult } from "../match";
import type { Club, GameWorld } from "../model";
import type { Rng } from "../random";
import { pickEleven, squadPlayers } from "../squad";
import { clubStrength } from "../strength";
import { HALF_TIME, HALF_TIME_RECOVERY, MANAGER_INTERVAL, MATCH_SECONDS, MIN_ADDED_MINUTES } from "./constants";
import { chooseAction } from "./decide";
import { refreshAttributes } from "./fatigue";
import { kickoff } from "./formation";
import { PITCH_LENGTH, PITCH_WIDTH } from "./geometry";
import { applyTactics, bench, makePendingSubs, requestSub, subsLeft } from "./lineup";
import { moveOffBall, pickUpLooseBall } from "./movement";
import { createReferee } from "./referee";
import { act, attemptTackle } from "./resolve";
import {
  ballDead,
  emit,
  fromTeamFrame,
  opponent,
  owner,
  type MatchEvent,
  type MatchPlayer,
  type MatchState,
  type Side,
} from "./state";

export { applyTactics, requestSub } from "./lineup";

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
  for (const side of ["home", "away"] as const) {
    if (new Set(squadPlayers(world, clubs[side])).size < 7) {
      throw new Error(`${side} must have at least 7 players available to start a match`);
    }
  }
  const strength = { home: clubStrength(world, home), away: clubStrength(world, away) };

  const team = (side: Side) => {
    const manager = managers[side] ?? defaultManager;
    const tactics = manager.prematch({ strength: strength[side], opponentStrength: strength[opponent(side)] });
    return { manager, tactics, strength: strength[side], subsUsed: 0, pendingSubs: [] };
  };
  const teams = { home: team("home"), away: team("away") };

  const players: MatchPlayer[] = [];
  const offPitch: MatchState["offPitch"] = [];
  for (const side of ["home", "away"] as const) {
    const eleven = pickEleven(world, clubs[side], teams[side].tactics.formation);
    eleven.forEach((p, i) => {
      players.push({
        id: p.id,
        side,
        position: p.position, // natural position until the manager's formation is applied
        natural: p.position,
        base: p.attributes,
        attributes: { ...p.attributes },
        energy: 1,
        slot: { x: 0, y: i }, // placeholder ordering; arrangeSide sets the real slot
        pos: { x: 0, y: 0 },
        cooldown: 0,
        yellow: false,
      });
    });
    for (const p of squadPlayers(world, clubs[side])) {
      if (!eleven.includes(p)) offPitch.push({ id: p.id, side, natural: p.position, attributes: p.attributes, reason: "bench" });
    }
  }

  const state: MatchState = {
    time: 0,
    period: 1,
    clock: 0,
    periodEnd: Infinity,
    stoppage: 0,
    announcedStoppage: 0,
    announcedEnd: Infinity,
    phase: "first_half",
    players,
    offPitch,
    ball: {
      pos: { x: PITCH_LENGTH / 2, y: PITCH_WIDTH / 2 },
      ownerId: null,
      lastSide: "home",
      lastTouch: "home",
      readyAt: 0,
      runnerId: null,
      setPiece: null,
    },
    referee: createReferee(rng),
    score: { home: 0, away: 0 },
    xg: { home: 0, away: 0 },
    teams,
    events: [],
    rng,
  };

  for (const side of ["home", "away"] as const) {
    applyTactics(state, side, state.teams[side].tactics, true);
    for (const p of players) if (p.side === side) p.pos = fromTeamFrame(side, p.slot);
  }
  return state;
}

function managerContext(state: MatchState, side: Side): ManagerContext {
  const team = state.teams[side];
  return {
    minute: Math.floor(state.clock / 60),
    goalsFor: state.score[side],
    goalsAgainst: state.score[opponent(side)],
    strength: team.strength,
    opponentStrength: state.teams[opponent(side)].strength,
    tactics: team.tactics,
    onPitch: state.players
      .filter((p) => p.side === side)
      .map((p) => ({ id: p.id, role: p.position, natural: p.natural, attributes: p.base, energy: p.energy, yellow: p.yellow })),
    bench: bench(state, side).map((b) => ({ id: b.id, natural: b.natural, attributes: b.attributes })),
    subsLeft: subsLeft(state, side) - team.pendingSubs.length,
  };
}

function consultManagers(state: MatchState): void {
  for (const side of ["home", "away"] as const) {
    const manager = state.teams[side].manager;
    applyTactics(state, side, manager.inMatch(managerContext(state, side)));
    for (const sub of manager.substitutions?.(managerContext(state, side)) ?? []) {
      requestSub(state, side, sub.offId, sub.onId);
    }
  }
}

// Goals, red cards and injuries make managers look again straight away
function somethingHappened(state: MatchState): boolean {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i]!;
    if (e.time < state.time - 1) return false;
    if (e.time !== state.time - 1) continue;
    if (e.type === "shot" && e.outcome === "goal") return true;
    if (e.type === "card" && e.card !== "yellow") return true;
    if (e.type === "injury") return true;
  }
  return false;
}

// One second of play: the carrier may be challenged, then (once they've
// controlled the ball) decides and acts;
// everyone else moves; a loose ball goes to whoever reaches it.
export function tick(state: MatchState): void {
  for (const p of state.players) {
    if (p.cooldown > 0) p.cooldown--;
    refreshAttributes(p);
  }

  const carrier = owner(state);
  if (carrier && !attemptTackle(state, carrier) && state.time >= state.ball.readyAt && !ballDead(state)) {
    const current = owner(state);
    if (current) act(state, current, chooseAction(state, current));
  }

  if (isFullTime(state)) return;
  moveOffBall(state);
  if (state.ball.ownerId === null) pickUpLooseBall(state);
}

export function startEventMatch(
  world: GameWorld,
  home: Club,
  away: Club,
  rng: Rng = Math.random,
  managers: Managers = {},
): MatchState {
  const state = createMatchState(world, home, away, rng, managers);
  kickoff(state, "home", undefined, true);
  return state;
}

export const isFullTime = (state: MatchState): boolean => state.phase === "full_time" || state.phase === "abandoned";

function startSecondHalf(state: MatchState): void {
  state.period = 2;
  state.clock = HALF_TIME;
  state.periodEnd = Infinity;
  state.stoppage = 0;
  state.announcedStoppage = 0;
  state.announcedEnd = Infinity;
  state.phase = "second_half";
  for (const p of state.players) p.energy = Math.min(1, p.energy + HALF_TIME_RECOVERY);
  // Half time is the natural moment for changes
  makePendingSubs(state);
  kickoff(state, "away", undefined, true);
}

// Advances the match by one second. At the end of normal time in each half the
// fourth official shows the added time, built up from that half's stoppages.
// Managers look at the game every few minutes and straight after big moments;
// substitutions wait for the ball to go dead.
export function stepEventMatch(state: MatchState): void {
  if (isFullTime(state)) return;
  if (state.phase === "half_time") startSecondHalf(state);

  state.time++;
  state.clock++;
  const regulation = state.period === 1 ? HALF_TIME : MATCH_SECONDS;
  if (state.clock === regulation) {
    const minutes = Math.max(MIN_ADDED_MINUTES[state.period - 1]!, Math.round(state.stoppage / 60));
    state.periodEnd = regulation + minutes * 60;
    state.announcedEnd = state.periodEnd;
    state.announcedStoppage = state.stoppage;
    emit(state, { type: "added_time", side: "home", minutes });
  }
  if (state.announcedEnd !== Infinity) {
    state.periodEnd = state.announcedEnd + state.stoppage - state.announcedStoppage;
  }
  // A late penalty must be taken, but the whistle still prevents rebound play.
  if (state.clock >= state.periodEnd && state.ball.setPiece !== "penalty") {
    const phase = state.period === 1 ? "half_time" : "full_time";
    emit(state, { type: "whistle", side: "home", phase });
    state.phase = phase;
    return;
  }

  const latePenalty = state.clock >= state.periodEnd && state.ball.setPiece === "penalty";
  if (state.clock % MANAGER_INTERVAL === 0 || somethingHappened(state)) consultManagers(state);
  if (ballDead(state)) makePendingSubs(state);
  tick(state);
  if (latePenalty && state.ball.setPiece !== "penalty") {
    // Extending a period solely for a penalty doesn't allow a goal celebration
    // or a rebound to start another spell of play.
    state.periodEnd = state.clock;
    state.announcedEnd = state.clock;
    state.announcedStoppage = state.stoppage;
  }
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

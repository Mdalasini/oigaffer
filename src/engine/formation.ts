import type { Position } from "../model";
import { pairedSpot, PLAY_PHASES, shapeOf, SPOTS, type PlayPhase, type Spot, type Tactics } from "../tactics";
import {
  ATTACK_PUSH,
  ATTACK_WIDTH,
  BUILD_UP_END,
  DEFEND_WIDTH,
  FINAL_THIRD_START,
  DEFEND_DROP,
  KEEPER_MAX_ADVANCE,
  MENTALITY_PUSH,
  MENTALITY_WIDTH,
  SETUP_TICKS,
  KICKOFF_HALF_MARGIN,
  SHIFT_X,
  SHIFT_Y,
} from "./constants";
import { add, CENTRE, clampToPitch, dist, normalize, PITCH_LENGTH, PITCH_WIDTH, scale, sub, type Vec } from "./geometry";
import {
  emit,
  fromTeamFrame,
  giveBall,
  ownGoal,
  toTeamFrame,
  type MatchPlayer,
  type MatchState,
  type Role,
  type Side,
} from "./state";

import { restartTicks } from "./restarts";

// Depth of each row of the tactics board in the team frame (own goal at x = 0):
// keeper, defence, wing-backs and holding midfield, midfield, attacking midfield and wingers, forwards
const ROW_X = [4, 20, 29, 38, 45, 50];
// The five columns of the board. Wide players stand a fifth of the way in: out at a sixth,
// a very attacking 4-4-2 stretched so wide it won about 0.2 points a game more.
const COLUMN_Y = [PITCH_WIDTH / 5, PITCH_WIDTH / 3, PITCH_WIDTH / 2, (2 * PITCH_WIDTH) / 3, (4 * PITCH_WIDTH) / 5];
// A central pair with nobody between them (two centre-backs, two central midfielders) stands this far apart,
// which puts a back four and a flat midfield four evenly across the pitch.
// Strikers keep their columns: closing a strike pair up to 14 m added about 0.7 goals a game.
const CENTRAL_PAIR_GAP = PITCH_WIDTH / 5;
const FRONT_ROW = 5;
// With a holding midfielder behind them, the central pair spreads into the half-spaces.
// Closer together, a 4-3-3 won about 0.4 points a game more than a 4-4-2 mirror match. Dropping
// the holding midfielder to 24 m balanced it too, but cut underdogs' counter-attacks against an
// attacking 4-3-3 by a third, and goals to about 2.4 a game.
const SCREENED_PAIR_GAP = 26;
// How deep and how high each line will go as the shape slides with the ball.
// Without a floor a pinned-back defence ends up standing on its own goal line.
const LINE_RANGE: Record<Position, [number, number]> = {
  GK: [0, 20],
  DEF: [12, 65],
  MID: [22, 85],
  FWD: [48, 100],
};

// Where a position stands in a formation, in the team frame
export function spotSlot(spot: Spot, formation: readonly Spot[]): Vec {
  const { row, col } = SPOTS[spot];
  const holding = formation.some((s) => SPOTS[s].row === 2 && SPOTS[s].line === "MID");
  const centreTaken = formation.some((s) => SPOTS[s].row === row && SPOTS[s].col === 2);
  const gap = row === 3 && holding ? SCREENED_PAIR_GAP : CENTRAL_PAIR_GAP;
  const y = (col === 1 || col === 3) && row !== FRONT_ROW && !centreTaken ? CENTRE.y + ((col - 2) * gap) / 2 : COLUMN_Y[col]!;
  return { x: ROW_X[row]!, y };
}

const LINES: Position[] = ["GK", "DEF", "MID", "FWD"];
// The position given to a lone player in a line the formation leaves empty
const LINE_SPOT: Record<Position, Spot> = { GK: "GK", DEF: "CB", MID: "CM", FWD: "CF" };

// Gives each player the slot of a position in the shape for their line.
// Players keep a position the shape still has (the manager may have put them there), unless
// the side is reshuffling into a new formation. Everyone else takes the free positions in
// left-to-right order, so nobody crosses the pitch to a new slot.
// A line that is short (after a red card) spreads out evenly at the line's depth instead.
export function arrangeSide(state: MatchState, side: Side, tactics: Tactics, reshuffle = false): void {
  const spots: Spot[] = ["GK", ...shapeOf(tactics)];
  const team = state.players.filter((p) => p.side === side).sort((a, b) => a.slot.y - b.slot.y);
  for (const line of LINES) {
    const players = team.filter((p) => p.position === line);
    const lineSpots = spots.filter((s) => SPOTS[s].line === line).sort((a, b) => SPOTS[a].col - SPOTS[b].col);
    const slots = lineSpots.map((s) => spotSlot(s, spots));
    if (players.length === lineSpots.length) {
      const taken = new Set<Spot>();
      const staying = reshuffle ? [] : players.filter((p) => lineSpots.includes(p.spot) && !taken.has(p.spot) && taken.add(p.spot));
      const free = lineSpots.filter((s) => !taken.has(s));
      players.filter((p) => !staying.includes(p)).forEach((p, i) => (p.spot = free[i]!));
      for (const p of players) p.slot = slots[lineSpots.indexOf(p.spot)]!;
      continue;
    }
    const x = slots.length > 0 ? slots.reduce((sum, s) => sum + s.x, 0) / slots.length : ROW_X[SPOTS[LINE_SPOT[line]].row]!;
    players.forEach((p, i) => {
      p.slot = { x, y: (PITCH_WIDTH * (i + 1)) / (players.length + 1) };
      let best = 0;
      for (let j = 1; j < slots.length; j++) {
        if (Math.abs(slots[j]!.y - p.slot.y) < Math.abs(slots[best]!.y - p.slot.y)) best = j;
      }
      p.spot = lineSpots[best] ?? LINE_SPOT[line];
    });
  }
  arrangePhases(team, tactics);
}

// In each phase of play every player takes the position paired with theirs in that phase's shape.
// A phase that uses the side's own shape copies their roles; in one that doesn't, a line with
// two players on one position (a side down to ten) spreads out evenly instead.
function arrangePhases(team: MatchPlayer[], tactics: Tactics): void {
  const shape = shapeOf(tactics);
  for (const phase of PLAY_PHASES) {
    const phaseShape = shapeOf(tactics, phase);
    if (phaseShape.every((s, i) => s === shape[i])) {
      for (const p of team) p.roles[phase] = { spot: p.spot, position: p.position, slot: p.slot };
      continue;
    }
    const spots: Spot[] = ["GK", ...phaseShape];
    for (const p of team) {
      const spot = p.position === "GK" ? "GK" : pairedSpot(tactics, p.spot, phase);
      p.roles[phase] = { spot, position: SPOTS[spot].line, slot: p.slot };
    }
    for (const line of LINES) {
      const roles = team.map((p) => p.roles[phase]).filter((r) => r.position === line);
      const slots = roles.map((r) => spotSlot(r.spot, spots));
      if (new Set(roles.map((r) => r.spot)).size === roles.length) {
        roles.forEach((r, i) => (r.slot = slots[i]!));
        continue;
      }
      const x = slots.reduce((sum, s) => sum + s.x, 0) / slots.length;
      roles.forEach((r, i) => (r.slot = { x, y: (PITCH_WIDTH * (i + 1)) / (roles.length + 1) }));
    }
  }
}

// The phase of play a side is in, from which third the ball is in (x in the side's team frame)
export function phaseAt(ballX: number, inPossession: boolean): PlayPhase {
  if (ballX < BUILD_UP_END) return inPossession ? "build_up" : "low_block";
  if (ballX < FINAL_THIRD_START) return inPossession ? "middle_third" : "mid_block";
  return inPossession ? "final_third" : "high_block";
}

// A player's role in the phase their side is in now
export function roleOf(state: MatchState, p: MatchPlayer, inPossession: boolean): Role {
  const ballX = p.side === "home" ? state.ball.pos.x : PITCH_LENGTH - state.ball.pos.x;
  return p.roles[phaseAt(ballX, inPossession)];
}

// Before the first arrangement, every phase uses the player's starting role
export const startingRoles = (role: Role): Record<PlayPhase, Role> =>
  Object.fromEntries(PLAY_PHASES.map((phase) => [phase, role])) as Record<PlayPhase, Role>;

// Where an off-ball player wants to be: their slot, slid towards the ball,
// pushed up and spread wide when their team has the ball, dropped back and narrow when it doesn't.
// Mentality sets how many bodies commit forward when the team has the ball.
export function anchor(state: MatchState, p: MatchPlayer, inPossession: boolean): Vec {
  const mentality = state.teams[p.side].tactics.mentality;
  // Scalar frame conversions (same arithmetic as toTeamFrame/fromTeamFrame) avoid allocating per call
  const away = p.side !== "home";
  const ballX = away ? PITCH_LENGTH - state.ball.pos.x : state.ball.pos.x;
  const ballY = away ? PITCH_WIDTH - state.ball.pos.y : state.ball.pos.y;
  const role = p.roles[phaseAt(ballX, inPossession)];
  const slot = role.slot;
  const x =
    slot.x +
    (ballX - CENTRE.x) * SHIFT_X +
    (inPossession ? ATTACK_PUSH + mentality * MENTALITY_PUSH : -DEFEND_DROP);
  const width = inPossession ? 1 + (ATTACK_WIDTH - 1) * (1 + MENTALITY_WIDTH * mentality) : DEFEND_WIDTH;
  const y = CENTRE.y + (slot.y - CENTRE.y) * width + (ballY - CENTRE.y) * SHIFT_Y;
  const range = LINE_RANGE[role.position];
  const minX = range[0], maxX = range[1];
  const clampedX = Math.min(PITCH_LENGTH, Math.max(0, Math.min(maxX, Math.max(minX, x))));
  const clampedY = Math.min(PITCH_WIDTH, Math.max(0, y));
  return away
    ? { x: PITCH_LENGTH - clampedX, y: PITCH_WIDTH - clampedY }
    : { x: clampedX, y: clampedY };
}

// Interpose between the ball and the middle of the goal, staying near the line
export function keeperPosition(state: MatchState, keeper: MatchPlayer): Vec {
  const goal = ownGoal(keeper.side);
  const toBall = sub(state.ball.pos, goal);
  const advance = Math.min(KEEPER_MAX_ADVANCE, dist(state.ball.pos, goal) * 0.15);
  return add(goal, scale(normalize(toBall), advance));
}

// Everyone back to their own half; a forward from the kicking team takes the ball on the spot.
// After a goal there's a delay while the scorers celebrate.
export function kickoffPosition(p: MatchPlayer): Vec {
  return fromTeamFrame(p.side, { x: Math.min(p.slot.x, CENTRE.x - KICKOFF_HALF_MARGIN), y: p.slot.y });
}

export function kickoff(state: MatchState, kicking: Side, delay: number = SETUP_TICKS.kickoff, placePlayers = false): void {
  for (const p of state.players) {
    if (placePlayers) {
      p.pos = kickoffPosition(p);
      p.vel.x = p.vel.y = 0;
      p.facing = p.side === "home" ? 0 : Math.PI;
      delete p.carryTarget;
    }
    p.cooldown = 0;
  }
  const kicker =
    state.players.find((p) => p.side === kicking && p.position === "FWD") ??
    state.players.find((p) => p.side === kicking && p.position !== "GK");
  if (!kicker) throw new Error(`No outfield player to kick off for ${kicking}`);
  if (placePlayers) kicker.pos = { ...CENTRE };
  giveBall(state, kicker, restartTicks(state, delay), "kickoff");
  state.ball.pos = { ...CENTRE };
  emit(state, { type: "kickoff", side: kicking });
}

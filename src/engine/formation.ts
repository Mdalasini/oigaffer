import type { Position } from "../model";
import {
  ATTACK_PUSH,
  ATTACK_WIDTH,
  DEFEND_WIDTH,
  DEFEND_DROP,
  KEEPER_MAX_ADVANCE,
  MENTALITY_PUSH,
  MENTALITY_WIDTH,
  SETUP_TICKS,
  KICKOFF_HALF_MARGIN,
  SHIFT_X,
  SHIFT_Y,
} from "./constants";
import { add, CENTRE, clampToPitch, dist, normalize, PITCH_WIDTH, scale, sub, type Vec } from "./geometry";
import {
  emit,
  fromTeamFrame,
  giveBall,
  ownGoal,
  toTeamFrame,
  type MatchPlayer,
  type MatchState,
  type Side,
} from "./state";

import { restartTicks } from "./restarts";

// Depth of each line in the team frame (own goal at x = 0)
const LINE_X: Record<Position, number> = { GK: 4, DEF: 20, MID: 38, FWD: 50 };
// How deep and how high each line will go as the shape slides with the ball.
// Without a floor a pinned-back defence ends up standing on its own goal line.
const LINE_RANGE: Record<Position, [number, number]> = {
  GK: [0, 20],
  DEF: [12, 65],
  MID: [22, 85],
  FWD: [48, 100],
};

// Spreads each positional line evenly across the pitch width.
// Works for any formation: the shape comes from how many players are in each line.
export function assignSlots(positions: Position[]): Vec[] {
  const lineSize = new Map<Position, number>();
  for (const pos of positions) lineSize.set(pos, (lineSize.get(pos) ?? 0) + 1);

  const placed = new Map<Position, number>();
  return positions.map((pos) => {
    const index = placed.get(pos) ?? 0;
    placed.set(pos, index + 1);
    const count = lineSize.get(pos)!;
    return { x: LINE_X[pos], y: (PITCH_WIDTH * (index + 1)) / (count + 1) };
  });
}

// Recomputes a side's formation slots from the roles its players hold.
// Players keep their left-to-right order, so nobody crosses the pitch to a new slot.
export function arrangeSide(state: MatchState, side: Side): void {
  const team = state.players.filter((p) => p.side === side).sort((a, b) => a.slot.y - b.slot.y);
  const slots = assignSlots(team.map((p) => p.position));
  team.forEach((p, i) => (p.slot = slots[i]!));
}

// Where an off-ball player wants to be: their slot, slid towards the ball,
// pushed up and spread wide when their team has the ball, dropped back and narrow when it doesn't.
// Mentality sets how many bodies commit forward when the team has the ball.
export function anchor(state: MatchState, p: MatchPlayer, inPossession: boolean): Vec {
  const mentality = state.teams[p.side].tactics.mentality;
  const ball = toTeamFrame(p.side, state.ball.pos);
  const x =
    p.slot.x +
    (ball.x - CENTRE.x) * SHIFT_X +
    (inPossession ? ATTACK_PUSH + mentality * MENTALITY_PUSH : -DEFEND_DROP);
  const width = inPossession ? 1 + (ATTACK_WIDTH - 1) * (1 + MENTALITY_WIDTH * mentality) : DEFEND_WIDTH;
  const y = CENTRE.y + (p.slot.y - CENTRE.y) * width + (ball.y - CENTRE.y) * SHIFT_Y;
  const [minX, maxX] = LINE_RANGE[p.position];
  return fromTeamFrame(p.side, clampToPitch({ x: Math.min(maxX, Math.max(minX, x)), y }));
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
    if (placePlayers) p.pos = kickoffPosition(p);
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

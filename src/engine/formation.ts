import type { Position } from "../model";
import {
  ATTACK_PUSH,
  DEFEND_DROP,
  KEEPER_MAX_ADVANCE,
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

// Depth of each line in the team frame (own goal at x = 0)
const LINE_X: Record<Position, number> = { GK: 4, DEF: 20, MID: 38, FWD: 50 };

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

// Where an off-ball player wants to be: their slot, slid towards the ball,
// pushed up when their team has the ball and dropped back when it doesn't.
export function anchor(state: MatchState, p: MatchPlayer, inPossession: boolean): Vec {
  const ball = toTeamFrame(p.side, state.ball.pos);
  const x = p.slot.x + (ball.x - CENTRE.x) * SHIFT_X + (inPossession ? ATTACK_PUSH : -DEFEND_DROP);
  const y = p.slot.y + (ball.y - CENTRE.y) * SHIFT_Y;
  return fromTeamFrame(p.side, clampToPitch({ x, y }));
}

// Interpose between the ball and the middle of the goal, staying near the line
export function keeperPosition(state: MatchState, keeper: MatchPlayer): Vec {
  const goal = ownGoal(keeper.side);
  const toBall = sub(state.ball.pos, goal);
  const advance = Math.min(KEEPER_MAX_ADVANCE, dist(state.ball.pos, goal) * 0.15);
  return add(goal, scale(normalize(toBall), advance));
}

// Everyone back to their own half; a forward from the kicking team takes the ball on the spot
export function kickoff(state: MatchState, kicking: Side): void {
  for (const p of state.players) {
    p.pos = fromTeamFrame(p.side, { x: Math.min(p.slot.x, CENTRE.x - 2), y: p.slot.y });
    p.cooldown = 0;
  }
  const kicker =
    state.players.find((p) => p.side === kicking && p.position === "FWD") ??
    state.players.find((p) => p.side === kicking && p.position !== "GK");
  if (!kicker) throw new Error(`No outfield player to kick off for ${kicking}`);
  kicker.pos = { ...CENTRE };
  giveBall(state, kicker, 1);
  emit(state, { type: "kickoff", side: kicking });
}

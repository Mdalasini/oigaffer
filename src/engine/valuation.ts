import {
  INTERCEPT_FALLOFF,
  INTERCEPT_MAX,
  PASS_CLEAR_START,
  PASS_BASE,
  PASS_DISTANCE_PENALTY,
  PASS_SKILL,
  POSSESSION_VALUE,
  PROGRESS_VALUE,
  PRESSURE_PASS_FACTOR,
  PRESSURE_RANGE,
  SHOT_PRESSURE_FACTOR,
  SHOT_SKILL,
  THREAT_SCALE,
  XG_DECAY,
  XG_MAX,
} from "./constants";
import { add, dist, distToSegment, normalize, PITCH_LENGTH, scale, sub, type Vec } from "./geometry";
import {
  attackingGoal,
  challengeSkill,
  nearest,
  opponent,
  opponents,
  teammates,
  toTeamFrame,
  type MatchPlayer,
  type MatchState,
  type Side,
} from "./state";

// Chance an average shot from here goes in: falls off with distance
// and with how tight the angle to goal is
export function baseXg(side: Side, pos: Vec): number {
  const goal = attackingGoal(side);
  const d = dist(pos, goal);
  const angle = d < 0.5 ? 1 : 0.3 + (0.7 * Math.abs(goal.x - pos.x)) / d;
  return XG_MAX * Math.exp(-d / XG_DECAY) * angle;
}

// What it's worth for `side` to have the ball at `pos`, in expected goals
export const possessionValue = (side: Side, pos: Vec): number =>
  POSSESSION_VALUE + PROGRESS_VALUE * (toTeamFrame(side, pos).x / PITCH_LENGTH) + THREAT_SCALE * baseXg(side, pos);

// Losing the ball here hands the opponent that much value
export const turnoverCost = (side: Side, pos: Vec): number => possessionValue(opponent(side), pos);

export function underPressure(state: MatchState, p: MatchPlayer): boolean {
  const marker = nearest(opponents(state, p), p.pos);
  return marker !== undefined && dist(marker.pos, p.pos) < PRESSURE_RANGE;
}

export function shotXg(state: MatchState, shooter: MatchPlayer): number {
  let xg = baseXg(shooter.side, shooter.pos) * (1 + SHOT_SKILL * (shooter.attributes.shooting - 10));
  if (underPressure(state, shooter)) xg *= SHOT_PRESSURE_FACTOR;
  return Math.min(xg, 0.95);
}

export interface InterceptRisk {
  player: MatchPlayer;
  risk: number;
}

export interface PassAssessment {
  success: number;
  risks: InterceptRisk[];
}

// Accuracy falls with distance and pressure; every opponent near the lane
// gets a chance to cut it out
export function assessPass(state: MatchState, passer: MatchPlayer, receiver: MatchPlayer): PassAssessment {
  const d = dist(passer.pos, receiver.pos);
  let success = (PASS_BASE - PASS_DISTANCE_PENALTY * d) * (1 - PASS_SKILL * (20 - passer.attributes.passing));
  if (underPressure(state, passer)) success *= PRESSURE_PASS_FACTOR;

  const laneStart = add(passer.pos, scale(normalize(sub(receiver.pos, passer.pos)), Math.min(PASS_CLEAR_START, d)));
  const risks: InterceptRisk[] = [];
  for (const o of opponents(state, passer)) {
    const gap = distToSegment(o.pos, laneStart, receiver.pos);
    const risk = INTERCEPT_MAX * Math.exp(-gap / INTERCEPT_FALLOFF) * (0.7 + challengeSkill(o) * 0.015);
    if (risk > 0.01) {
      risks.push({ player: o, risk });
      success *= 1 - risk;
    }
  }
  return { success: Math.max(0, success), risks };
}

// Rough odds of winning a loose ball at `pos`: whoever has a player closer is favoured
export function looseBallWinChance(state: MatchState, p: MatchPlayer, pos: Vec): number {
  const ours = nearest([p, ...teammates(state, p)], pos);
  const theirs = nearest(opponents(state, p), pos);
  if (!ours || !theirs) return 0.5;
  const dOurs = dist(ours.pos, pos) + 1;
  const dTheirs = dist(theirs.pos, pos) + 1;
  return dTheirs / (dOurs + dTheirs);
}

import {
  AERIAL_BASE,
  AERIAL_CONTEST_RANGE,
  AERIAL_CROWD,
  AERIAL_CROWD_RANGE,
  AERIAL_FREE,
  AERIAL_SKILL,
  CROSS_BASE,
  CROSS_SKILL,
  FREE_KICK_XG_DECAY,
  FREE_KICK_XG_MAX,
  HEADER_XG_FACTOR,
  KEEPER_CLAIM,
  KEEPER_CLAIM_SKILL,
  PENALTY_SKILL,
  PENALTY_XG,
  INTERCEPT_FALLOFF,
  INTERCEPT_MAX,
  KEEPER_SPEED,
  PRESS_SPEED,
  PASS_CLEAR_START,
  PASS_BASE,
  PASS_DISTANCE_PENALTY,
  PASS_SKILL,
  POSSESSION_VALUE,
  PROGRESS_VALUE,
  RACE_SHARPNESS,
  RUN_SPEED,
  PRESSURE_PASS_FACTOR,
  PRESSURE_RANGE,
  SHOT_PRESSURE_FACTOR,
  SHOT_SKILL,
  THREAT_SCALE,
  XG_DECAY,
  XG_MAX,
} from "./constants";
import { add, dist, distSq, distToSegment, normalize, PITCH_LENGTH, REJECT_MARGIN, scale, sub, type Vec } from "./geometry";
import {
  attackingGoal,
  challengeSkill,
  keeperOf,
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

// True when the nearest opponent is inside the pressure range. That is the same as asking
// whether any opponent is, so the scan stops at the first one found.
export function underPressure(state: MatchState, p: MatchPlayer): boolean {
  const limit = PRESSURE_RANGE * PRESSURE_RANGE * REJECT_MARGIN;
  for (const o of state.players) {
    if (o.side === p.side || distSq(o.pos, p.pos) > limit) continue;
    if (dist(o.pos, p.pos) < PRESSURE_RANGE) return true;
  }
  return false;
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

// Interception risks at or below this are ignored
const RISK_CUTOFF = 0.01;
// Beyond this distance an opponent's risk is below RISK_CUTOFF (with a sub-ppb margin)
const INTERCEPT_REACH = INTERCEPT_FALLOFF * Math.log(INTERCEPT_MAX / RISK_CUTOFF) * (1 + 1e-9);

// Accuracy falls with distance and pressure; every opponent near the lane
// gets a chance to cut it out
export function assessPass(state: MatchState, passer: MatchPlayer, target: Vec): PassAssessment {
  const d = dist(passer.pos, target);
  let success = (PASS_BASE - PASS_DISTANCE_PENALTY * d) * (1 - PASS_SKILL * (20 - passer.attributes.passing));
  if (underPressure(state, passer)) success *= PRESSURE_PASS_FACTOR;

  const laneStart = add(passer.pos, scale(normalize(sub(target, passer.pos)), Math.min(PASS_CLEAR_START, d)));
  const risks: InterceptRisk[] = [];
  // The lane lies inside its bounding box, so a body whose box is further away than
  // INTERCEPT_REACH cannot reach the risk cut-off (skills are at most 20, so the factor is at most 1).
  const minX = Math.min(laneStart.x, target.x), maxX = Math.max(laneStart.x, target.x);
  const minY = Math.min(laneStart.y, target.y), maxY = Math.max(laneStart.y, target.y);
  for (const o of opponents(state, passer)) {
    const bx = Math.max(minX - o.pos.x, 0, o.pos.x - maxX), by = Math.max(minY - o.pos.y, 0, o.pos.y - maxY);
    if (bx * bx + by * by > INTERCEPT_REACH * INTERCEPT_REACH) continue;
    const gap = distToSegment(o.pos, laneStart, target);
    const risk = INTERCEPT_MAX * Math.exp(-gap / INTERCEPT_FALLOFF) * (0.7 + challengeSkill(o) * 0.015);
    if (risk > RISK_CUTOFF) {
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

// Chance the runner beats every opponent (keeper included) to a ball played into space
export function raceWinChance(state: MatchState, runner: MatchPlayer, target: Vec): number {
  const runnerTime = dist(runner.pos, target) / RUN_SPEED;
  let defenderTime = Infinity;
  for (const o of opponents(state, runner)) {
    const speed = o.position === "GK" ? KEEPER_SPEED : PRESS_SPEED;
    defenderTime = Math.min(defenderTime, dist(o.pos, target) / speed);
  }
  return 1 / (1 + Math.exp(-RACE_SHARPNESS * (defenderTime - runnerTime)));
}

export interface CrossAssessment {
  delivery: number; // ball reaches the target area
  claim: number; // keeper comes and takes it
  duel: number; // target wins the header
  defender: MatchPlayer | null; // who challenges them
  xg: number; // the header, if they win it
}

// A ball into the box for `target`: it has to be delivered, get past the keeper,
// and be won in the air. Shooting stands in for heading, tackling for defensive heading.
export function assessCross(state: MatchState, crosser: MatchPlayer, target: MatchPlayer): CrossAssessment {
  const clamp01 = (v: number) => Math.min(0.95, Math.max(0.05, v));
  const delivery = clamp01(CROSS_BASE + CROSS_SKILL * (crosser.attributes.passing - 10));
  const keeper = keeperOf(state, opponent(crosser.side));
  const nearGoal = dist(target.pos, attackingGoal(crosser.side)) < 8;
  const claim = keeper
    ? clamp01((KEEPER_CLAIM + KEEPER_CLAIM_SKILL * (keeper.attributes.goalkeeping - 10)) * (nearGoal ? 1.4 : 0.7))
    : 0;
  const defender = nearest(
    opponents(state, target).filter((o) => o.position !== "GK"),
    target.pos,
  );
  const contested = defender !== undefined && dist(defender.pos, target.pos) < AERIAL_CONTEST_RANGE;
  // A packed box is hard to win anything in
  const crowd = opponents(state, target).filter(
    (o) => o !== defender && o.position !== "GK" && dist(o.pos, target.pos) < AERIAL_CROWD_RANGE,
  ).length;
  const oneOnOne = contested
    ? AERIAL_BASE + AERIAL_SKILL * (target.attributes.shooting - defender.attributes.tackling)
    : AERIAL_FREE;
  const duel = clamp01(oneOnOne * (1 - AERIAL_CROWD) ** crowd);
  const xg = Math.min(0.9, baseXg(target.side, target.pos) * HEADER_XG_FACTOR * (1 + SHOT_SKILL * (target.attributes.shooting - 10)));
  return { delivery, claim, duel, defender: contested ? defender : null, xg };
}

// Over or round the wall: much harder than an open shot from the same distance
export function freeKickXg(taker: MatchPlayer): number {
  const goal = attackingGoal(taker.side);
  const d = dist(taker.pos, goal);
  const angle = 0.3 + (0.7 * Math.abs(goal.x - taker.pos.x)) / Math.max(d, 1);
  const skill = 1 + 2 * SHOT_SKILL * (taker.attributes.shooting - 10);
  return Math.min(0.3, FREE_KICK_XG_MAX * Math.exp(-(d - 16) / FREE_KICK_XG_DECAY) * angle * skill);
}

export function penaltyXg(state: MatchState, taker: MatchPlayer): number {
  const keeper = keeperOf(state, opponent(taker.side));
  const diff = taker.attributes.shooting - (keeper?.attributes.goalkeeping ?? 1);
  return Math.min(0.92, Math.max(0.55, PENALTY_XG + PENALTY_SKILL * diff));
}

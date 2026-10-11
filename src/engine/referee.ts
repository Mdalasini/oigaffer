import {
  ADDED,
  ADVANTAGE_CHANCE,
  BOOKED_CAUTION,
  DOGSO_RANGE,
  DOGSO_WIDTH,
  INJURY_CHANCE,
  MOVE_SPEED,
  OFFSIDE_TOLERANCE,
  REFEREE_STRICTNESS,
  STRAIGHT_RED_CHANCE,
  TACTICAL_YELLOW_CHANCE,
  YELLOW_CHANCE,
} from "./constants";
import { CENTRE, moveTowards, PITCH_LENGTH, type Vec } from "./geometry";
import { injure, sendOff } from "./lineup";
import type { Rng } from "../random";
import { awardFreeKick, inBox } from "./restarts";
import { emit, opponent, toTeamFrame, type Card, type MatchPlayer, type MatchState, type Referee, type Side } from "./state";

export function createReferee(rng: Rng): Referee {
  const [lo, hi] = REFEREE_STRICTNESS;
  return { strictness: lo + rng() * (hi - lo), pos: { ...CENTRE } };
}

// The ref keeps up with play from a few metres off it, on the side away from the nearest touchline
export function moveReferee(state: MatchState): void {
  const { pos } = state.ball;
  const target: Vec = { x: pos.x + (pos.x < CENTRE.x ? 8 : -8), y: pos.y + (pos.y < CENTRE.y ? 10 : -10) };
  state.referee.pos = moveTowards(state.referee.pos, target, MOVE_SPEED);
}

// Attackers can't be beyond the second-last defender (or the ball), unless they're in their own half
export function offsideLine(state: MatchState, attacking: Side): number {
  const depths = state.players
    .filter((p) => p.side !== attacking)
    .map((p) => toTeamFrame(attacking, p.pos).x)
    .sort((a, b) => b - a);
  const ballX = toTeamFrame(attacking, state.ball.pos).x;
  return Math.max(depths[1] ?? CENTRE.x, ballX, CENTRE.x);
}

// How far beyond the line a player is (negative when onside)
export const offsideBy = (state: MatchState, p: MatchPlayer): number =>
  toTeamFrame(p.side, p.pos).x - offsideLine(state, p.side);

// The assistant flags anyone clearly beyond the line when the ball is played to them
export const flaggedOffside = (state: MatchState, receiver: MatchPlayer): boolean =>
  offsideBy(state, receiver) > OFFSIDE_TOLERANCE;

// The fouler was the last outfield defender between a central attacker and goal
function deniesGoalScoringChance(state: MatchState, fouler: MatchPlayer, victim: MatchPlayer): boolean {
  const at = toTeamFrame(victim.side, victim.pos);
  if (at.x < PITCH_LENGTH - DOGSO_RANGE || Math.abs(at.y - CENTRE.y) > DOGSO_WIDTH) return false;
  return !state.players.some(
    (d) => d.side === fouler.side && d !== fouler && d.position !== "GK" && toTeamFrame(victim.side, d.pos).x > at.x,
  );
}

function decideCard(state: MatchState, fouler: MatchPlayer, victim: MatchPlayer, tactical: boolean, penalty: boolean): Card | null {
  const strict = state.referee.strictness;
  // Stopping a clear chance is a red, unless it's a penalty (the spot kick restores the chance)
  if (deniesGoalScoringChance(state, fouler, victim) && !penalty) return "red";
  if (state.rng() < STRAIGHT_RED_CHANCE * strict) return "red";
  const yellow = (tactical ? TACTICAL_YELLOW_CHANCE : YELLOW_CHANCE) * strict;
  if (state.rng() < yellow * (fouler.yellow ? BOOKED_CAUTION : 1)) return fouler.yellow ? "second_yellow" : "yellow";
  return null;
}

// A foul has been committed on the ball carrier. The ref decides the restart,
// any card, and whether the victim is hurt. Returns true if play stopped.
export function judgeFoul(state: MatchState, fouler: MatchPlayer, victim: MatchPlayer, tactical: boolean): boolean {
  const penalty = inBox(victim.side, victim.pos);
  const card = decideCard(state, fouler, victim, tactical, penalty);
  const hurt = state.rng() < INJURY_CHANCE;
  const inAttackingHalf = toTeamFrame(victim.side, victim.pos).x > CENTRE.x;
  // Play on when the attack is still alive, unless someone needs treatment
  const advantage = !penalty && !hurt && card !== "red" && inAttackingHalf && state.rng() < ADVANTAGE_CHANCE;

  emit(state, {
    type: "foul",
    side: fouler.side,
    playerId: fouler.id,
    victimId: victim.id,
    award: penalty ? "penalty" : advantage ? "advantage" : "free_kick",
  });
  if (card) {
    emit(state, { type: "card", side: fouler.side, playerId: fouler.id, card });
    state.stoppage += ADDED.card;
    if (card === "yellow") fouler.yellow = true;
    else sendOff(state, fouler);
  }
  if (advantage) return false;

  const spot = { ...victim.pos };
  if (hurt) injure(state, victim);
  awardFreeKick(state, opponent(fouler.side), spot, true, hurt ? undefined : victim);
  return true;
}

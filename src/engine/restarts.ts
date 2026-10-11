import type { Position } from "../model";
import {
  ADDED,
  BOX_DEPTH,
  BOX_HALF_WIDTH,
  DANGEROUS_FREE_KICK_TICKS,
  FREE_KICK_SHOT_RANGE,
  GOAL_AREA_DEPTH,
  KEEPER_HOLD_TICKS,
  PENALTY_SPOT,
  SETUP_TICKS,
  RESTART_VARIATION,
} from "./constants";
import { add, CENTRE, dist, normalize, PITCH_LENGTH, PITCH_WIDTH, scale, sub, type Vec } from "./geometry";
import {
  attackingGoal,
  emit,
  fromTeamFrame,
  giveBall,
  keeperOf,
  looseBall,
  nearest,
  opponent,
  ownGoal,
  toTeamFrame,
  type MatchPlayer,
  type MatchState,
  type SetPiece,
  type Side,
} from "./state";

export const onPitch = (v: Vec): boolean => v.x >= 0 && v.x <= PITCH_LENGTH && v.y >= 0 && v.y <= PITCH_WIDTH;

// Inside the penalty area `attacking` is shooting at
export function inBox(attacking: Side, v: Vec): boolean {
  const t = toTeamFrame(attacking, v);
  return t.x > PITCH_LENGTH - BOX_DEPTH && Math.abs(t.y - CENTRE.y) < BOX_HALF_WIDTH;
}

const outfield = (state: MatchState, side: Side) => state.players.filter((p) => p.side === side && p.position !== "GK");
const best = (players: MatchPlayer[], skill: (p: MatchPlayer) => number) =>
  players.reduce<MatchPlayer | undefined>((a, b) => (!a || skill(b) > skill(a) ? b : a), undefined);

// The ball waits on the spot while the taker walks over and the restart is prepared.
export function restartTicks(state: MatchState, ticks: number): number {
  return ticks * (1 - RESTART_VARIATION + 2 * RESTART_VARIATION * state.rng());
}

function setUp(state: MatchState, kind: Exclude<SetPiece, "kickoff">, taker: MatchPlayer, spot: Vec, ticks: number): void {
  giveBall(state, taker, restartTicks(state, ticks), kind);
  state.ball.pos = { ...spot };
  emit(state, { type: "set_piece", side: taker.side, kind, playerId: taker.id });
}

// Where a kicked or deflected ball ends up. Leaving the pitch gives the right restart.
export function placeBall(state: MatchState, pos: Vec, touchedBy: Side, runnerId: string | null = null): void {
  if (onPitch(pos)) {
    looseBall(state, pos, runnerId);
    state.ball.lastTouch = touchedBy;
    return;
  }
  if (pos.x >= 0 && pos.x <= PITCH_LENGTH) {
    throwIn(state, opponent(touchedBy), { x: pos.x, y: pos.y < 0 ? 0 : PITCH_WIDTH });
    return;
  }
  // Over a goal line: a corner if the defending side touched it last, otherwise a goal kick
  const defending: Side = pos.x < 0 ? "home" : "away";
  const flag = { x: pos.x < 0 ? 0 : PITCH_LENGTH, y: pos.y < CENTRE.y ? 0 : PITCH_WIDTH };
  if (touchedBy === defending) corner(state, opponent(defending), flag);
  else goalKick(state, defending);
}

export function throwIn(state: MatchState, side: Side, spot: Vec): void {
  const taker = nearest(outfield(state, side), spot);
  if (taker) setUp(state, "throw_in", taker, spot, SETUP_TICKS.throw_in);
}

export function corner(state: MatchState, side: Side, flag: Vec): void {
  const taker = best(outfield(state, side), (p) => p.attributes.passing);
  if (taker) setUp(state, "corner", taker, flag, SETUP_TICKS.corner);
}

// Ball to the keeper just inside the six-yard box
export function goalKick(state: MatchState, side: Side): void {
  const taker = keeperOf(state, side) ?? nearest(state.players.filter((p) => p.side === side), ownGoal(side));
  if (!taker) return;
  const spot = add(ownGoal(side), scale(normalize(sub(attackingGoal(side), ownGoal(side))), GOAL_AREA_DEPTH - 0.5));
  setUp(state, "goal_kick", taker, spot, Math.max(SETUP_TICKS.goal_kick, KEEPER_HOLD_TICKS));
}

// A foul gives a direct free kick, or a penalty in the box; offside gives an indirect one.
// The fouled player usually takes it; in shooting range the best shooter steps up.
export function awardFreeKick(state: MatchState, side: Side, spot: Vec, direct: boolean, victim?: MatchPlayer): void {
  if (direct && inBox(side, spot)) {
    penalty(state, side);
    return;
  }
  const players = outfield(state, side);
  if (players.length === 0) return;
  const shootingRange = direct && dist(spot, attackingGoal(side)) < FREE_KICK_SHOT_RANGE;
  const taker = shootingRange
    ? best(players, (p) => p.attributes.shooting)!
    : victim && state.players.includes(victim)
      ? victim
      : nearest(players, spot)!;
  const ticks = shootingRange ? DANGEROUS_FREE_KICK_TICKS : SETUP_TICKS.free_kick;
  setUp(state, direct ? "free_kick" : "indirect_free_kick", taker, spot, ticks);
}

// Everyone but the taker and keeper waits outside the box
export function penalty(state: MatchState, side: Side): void {
  const taker = best(outfield(state, side), (p) => p.attributes.shooting);
  if (!taker) return;
  state.stoppage += ADDED.penalty;
  setUp(state, "penalty", taker, fromTeamFrame(side, { x: PITCH_LENGTH - PENALTY_SPOT, y: CENTRE.y }), SETUP_TICKS.penalty);
}

// ---------- Set-piece positions ----------

// Spots in the attacking team's frame for a corner from either side
const ATTACK_SPOTS: Vec[] = [
  { x: 99, y: 30 },
  { x: 99, y: 38 },
  { x: 94, y: 34 },
  { x: 96, y: 27 },
  { x: 96, y: 41 },
  { x: 90, y: 34 },
];
const DEFEND_SPOTS: Vec[] = [
  { x: 103, y: 31 },
  { x: 103, y: 37 },
  { x: 100, y: 34 },
  { x: 98, y: 28 },
  { x: 98, y: 40 },
  { x: 95, y: 34 },
  { x: 91, y: 29 },
  { x: 91, y: 39 },
];
// Who goes up for a corner: the big defenders and forwards first
const AERIAL_ORDER: Position[] = ["DEF", "FWD", "MID"];

// Where a player stands while a corner is being set up, or null to keep their normal shape.
// The attacking team leaves a couple back; the defending team leaves its most advanced forward up.
export function cornerPosition(state: MatchState, p: MatchPlayer): Vec | null {
  if (state.ball.setPiece !== "corner") return null;
  const taker = state.players.find((q) => q.id === state.ball.ownerId);
  if (!taker || p === taker || p.position === "GK") return null;
  const attacking = taker.side;

  const team = state.players
    .filter((q) => q.side === p.side && q.position !== "GK" && q !== taker)
    .sort((a, b) => AERIAL_ORDER.indexOf(a.position) - AERIAL_ORDER.indexOf(b.position));
  if (p.side === attacking) {
    const i = team.indexOf(p);
    return i < ATTACK_SPOTS.length ? fromTeamFrame(attacking, ATTACK_SPOTS[i]!) : null;
  }
  const outlet = team.reduce((a, b) => (toTeamFrame(attacking, b.pos).x < toTeamFrame(attacking, a.pos).x ? b : a));
  const defenders = team.filter((q) => q !== outlet);
  const i = defenders.indexOf(p);
  return i >= 0 && i < DEFEND_SPOTS.length ? fromTeamFrame(attacking, DEFEND_SPOTS[i]!) : null;
}

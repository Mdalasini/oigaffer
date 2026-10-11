import {
  BLOCK_CHANCE,
  BLOCK_RANGE,
  KEEPER_HOLD,
  KEEPER_HOLD_TICKS,
  KEEPER_SKILL,
  ON_TARGET_BASE,
  ON_TARGET_SKILL,
  TACKLE_ATTEMPT,
  TACKLE_BASE,
  TACKLE_COOLDOWN,
  TACKLE_RANGE,
  TACKLE_SKILL,
} from "./constants";
import { clearanceTarget, type Action } from "./decide";
import { kickoff } from "./formation";
import { add, clampToPitch, dist, distToSegment, normalize, scale, sub, type Vec } from "./geometry";
import {
  attackingGoal,
  challengeSkill,
  emit,
  giveBall,
  keeperOf,
  looseBall,
  nearest,
  opponent,
  opponents,
  ownGoal,
  type MatchPlayer,
  type MatchState,
} from "./state";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Random point between minR and maxR metres from `pos`
function scatter(state: MatchState, pos: Vec, minR: number, maxR: number): Vec {
  const angle = state.rng() * Math.PI * 2;
  const r = minR + state.rng() * (maxR - minR);
  return clampToPitch({ x: pos.x + Math.cos(angle) * r, y: pos.y + Math.sin(angle) * r });
}

// The nearest defender to the carrier may try to win the ball before they act.
// Keepers holding the ball can't be tackled.
export function attemptTackle(state: MatchState, carrier: MatchPlayer): boolean {
  if (carrier.position === "GK") return false;
  const ready = opponents(state, carrier).filter((o) => o.cooldown === 0 && o.position !== "GK");
  const tackler = nearest(ready, carrier.pos);
  if (!tackler || dist(tackler.pos, carrier.pos) > TACKLE_RANGE) return false;
  if (state.rng() > TACKLE_ATTEMPT) return false;

  tackler.cooldown = TACKLE_COOLDOWN;
  const winChance = clamp(TACKLE_BASE + TACKLE_SKILL * (challengeSkill(tackler) - carrier.attributes.dribbling), 0.1, 0.8);
  const won = state.rng() < winChance;
  emit(state, { type: "tackle", side: tackler.side, playerId: tackler.id, carrierId: carrier.id, won });
  if (won) {
    carrier.cooldown = TACKLE_COOLDOWN;
    giveBall(state, tackler);
  }
  return won;
}

function resolvePass(state: MatchState, passer: MatchPlayer, action: Action & { kind: "pass" }): void {
  if (state.rng() < action.success) {
    giveBall(state, action.receiver);
    emit(state, { type: "pass", side: passer.side, playerId: passer.id, receiverId: action.receiver.id });
    return;
  }

  // Failed: either someone near the lane cut it out, or it simply went astray
  const totalRisk = action.risks.reduce((s, r) => s + r.risk, 0);
  const failure = 1 - action.success;
  if (totalRisk > 0 && state.rng() < Math.min(1, totalRisk / failure)) {
    let roll = state.rng() * totalRisk;
    const interceptor = action.risks.find((r) => (roll -= r.risk) <= 0)?.player ?? action.risks[0]!.player;
    giveBall(state, interceptor);
    emit(state, { type: "interception", side: interceptor.side, playerId: passer.id, interceptorId: interceptor.id });
    return;
  }
  looseBall(state, scatter(state, action.receiver.pos, 4, 10));
  emit(state, { type: "pass_astray", side: passer.side, playerId: passer.id });
}

function resolveShot(state: MatchState, shooter: MatchPlayer, action: Action & { kind: "shoot" }): void {
  const side = shooter.side;
  const goal = attackingGoal(side);
  const keeper = keeperOf(state, opponent(side));
  state.xg[side] += action.xg;
  const shot = (outcome: "goal" | "saved" | "off_target" | "blocked") =>
    emit(state, { type: "shot", side, playerId: shooter.id, xg: action.xg, outcome, keeperId: keeper?.id });

  // Blocked by an outfield defender standing in the way
  const blockers = opponents(state, shooter).filter(
    (o) => o.position !== "GK" && distToSegment(o.pos, shooter.pos, goal) < BLOCK_RANGE,
  );
  if (blockers.some(() => state.rng() < BLOCK_CHANCE)) {
    shot("blocked");
    const towardGoal = normalize(sub(goal, shooter.pos));
    looseBall(state, scatter(state, add(shooter.pos, scale(towardGoal, 3)), 1, 4));
    return;
  }

  const onTarget = ON_TARGET_BASE + ON_TARGET_SKILL * shooter.attributes.shooting;
  if (state.rng() > onTarget) {
    shot("off_target");
    goalKick(state, opponent(side));
    return;
  }

  // On target: the keeper's ability scales the chance it beats them (1.0 for an average keeper)
  const keeperFactor = 1 - KEEPER_SKILL * ((keeper?.attributes.goalkeeping ?? 1) - 10);
  const goalChance = clamp((action.xg / onTarget) * keeperFactor, 0, 0.95);
  if (state.rng() < goalChance) {
    shot("goal");
    state.score[side]++;
    kickoff(state, opponent(side));
    return;
  }

  shot("saved");
  if (keeper && state.rng() < KEEPER_HOLD) {
    giveBall(state, keeper, KEEPER_HOLD_TICKS);
  } else {
    // Parried back into play in front of goal
    const ownGoalPos = ownGoal(opponent(side));
    const outward = normalize(sub(shooter.pos, ownGoalPos));
    looseBall(state, scatter(state, add(ownGoalPos, scale(outward, 8)), 1, 5));
  }
}

// Ball back to the defending keeper on the edge of the six-yard box
function goalKick(state: MatchState, side: "home" | "away"): void {
  const keeper = keeperOf(state, side);
  if (!keeper) {
    looseBall(state, ownGoal(side));
    return;
  }
  keeper.pos = add(ownGoal(side), scale(normalize(sub(attackingGoal(side), ownGoal(side))), 6));
  giveBall(state, keeper, KEEPER_HOLD_TICKS);
}

function resolveDribble(state: MatchState, carrier: MatchPlayer, action: Action & { kind: "dribble" }): void {
  const { defender } = action;
  if (state.rng() < action.beat) {
    carrier.pos = action.to;
    giveBall(state, carrier, 1);
    if (defender) defender.cooldown = TACKLE_COOLDOWN;
    emit(state, { type: "dribble", side: carrier.side, playerId: carrier.id, defenderId: defender?.id ?? null });
    return;
  }
  if (defender) {
    carrier.cooldown = TACKLE_COOLDOWN;
    giveBall(state, defender);
    emit(state, { type: "tackle", side: defender.side, playerId: defender.id, carrierId: carrier.id, won: true });
  } else {
    // Heavy touch with nobody around
    looseBall(state, action.to);
  }
}

function resolveClear(state: MatchState, carrier: MatchPlayer, action: Action & { kind: "clear" }): void {
  looseBall(state, scatter(state, clearanceTarget(carrier, action.distance), 0, 12));
  emit(state, { type: "clearance", side: carrier.side, playerId: carrier.id });
}

export function act(state: MatchState, carrier: MatchPlayer, action: Action): void {
  switch (action.kind) {
    case "pass":
      return resolvePass(state, carrier, action);
    case "shoot":
      return resolveShot(state, carrier, action);
    case "dribble":
      return resolveDribble(state, carrier, action);
    case "clear":
      return resolveClear(state, carrier, action);
  }
}

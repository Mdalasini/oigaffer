import {
  ADDED,
  BLOCK_CHANCE,
  BLOCK_FOR_CORNER,
  BLOCK_RANGE,
  BOOKED_CAUTION,
  BOX_FOUL_FACTOR,
  CROSS_BLOCK,
  CROSS_BLOCK_FOR_CORNER,
  CROSS_BLOCK_RANGE,
  HEADED_BEHIND,
  TACKLE_LOOSE,
  TACKLE_LOOSE_DISTANCE,
  FOUL_ON_FAILED_TACKLE,
  FOUL_TACKLING_SKILL,
  GOAL_CELEBRATION_TICKS,
  KEEPER_HOLD,
  KEEPER_HOLD_TICKS,
  KEEPER_SKILL,
  ON_TARGET_BASE,
  ON_TARGET_SKILL,
  PARRY_FOR_CORNER,
  TACKLE_ATTEMPT,
  TACKLE_BASE,
  TACKLE_COOLDOWN,
  TACKLE_RANGE,
  TACKLE_SKILL,
  TACTICAL_FOUL,
} from "./constants";
import { clearanceTarget, type Action } from "./decide";
import { tire } from "./fatigue";
import { kickoff } from "./formation";
import { add, CENTRE, dist, distToSegment, normalize, PITCH_LENGTH, PITCH_WIDTH, scale, sub, type Vec } from "./geometry";
import { flaggedOffside, judgeFoul } from "./referee";
import { awardFreeKick, corner, goalKick, inBox, placeBall } from "./restarts";
import {
  attackingGoal,
  ballDead,
  challengeSkill,
  emit,
  giveBall,
  keeperOf,
  nearest,
  opponent,
  opponents,
  ownGoal,
  toTeamFrame,
  type MatchPlayer,
  type MatchState,
  type ShotKind,
  type Side,
} from "./state";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Random point between minR and maxR metres from `pos`. It may be off the pitch.
function scatter(state: MatchState, pos: Vec, minR: number, maxR: number): Vec {
  const angle = state.rng() * Math.PI * 2;
  const r = minR + state.rng() * (maxR - minR);
  return { x: pos.x + Math.cos(angle) * r, y: pos.y + Math.sin(angle) * r };
}

// Pushed behind by the defending side: a corner on whichever side the ball was nearest
function behindGoalLine(state: MatchState, attacking: Side, near: Vec): void {
  const nearLeft = toTeamFrame(attacking, near).y < CENTRE.y;
  corner(state, attacking, toTeamFrame(attacking, { x: PITCH_LENGTH, y: nearLeft ? 0 : PITCH_WIDTH }));
}

// The nearest defender to the carrier may try to win the ball before they act.
// Keepers holding the ball can't be tackled, and nobody tackles at a dead ball.
// A mistimed challenge can be a foul.
export function attemptTackle(state: MatchState, carrier: MatchPlayer): boolean {
  if (carrier.position === "GK" || ballDead(state)) return false;
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
    if (state.rng() < TACKLE_LOOSE) {
      // Poked away: anyone's ball, and sometimes out of play
      const [lo, hi] = TACKLE_LOOSE_DISTANCE;
      placeBall(state, scatter(state, carrier.pos, lo, hi), tackler.side);
    } else {
      giveBall(state, tackler);
    }
    return true;
  }
  const care = (inBox(carrier.side, carrier.pos) ? BOX_FOUL_FACTOR : 1) * (tackler.yellow ? BOOKED_CAUTION : 1);
  const foulChance =
    FOUL_ON_FAILED_TACKLE * care * state.referee.strictness * (1 - FOUL_TACKLING_SKILL * (tackler.attributes.tackling - 10));
  if (state.rng() < foulChance) return judgeFoul(state, tackler, carrier, false);
  return false;
}

function resolvePass(state: MatchState, passer: MatchPlayer, action: Action & { kind: "pass" | "through" }): void {
  // Offside is judged the moment the ball is played; restarts like throw-ins are exempt
  const kind = state.ball.setPiece;
  const exempt = kind === "throw_in" || kind === "goal_kick" || kind === "corner";
  if (!exempt && flaggedOffside(state, action.receiver)) {
    emit(state, { type: "offside", side: passer.side, playerId: action.receiver.id, passerId: passer.id });
    awardFreeKick(state, opponent(passer.side), { ...action.receiver.pos }, false);
    return;
  }

  if (state.rng() < action.success) {
    if (action.kind === "through") {
      // Into space: the runner and the defence race for it
      emit(state, { type: "through_ball", side: passer.side, playerId: passer.id, receiverId: action.receiver.id });
      placeBall(state, scatter(state, action.target, 0, 3), passer.side, action.receiver.id);
    } else {
      giveBall(state, action.receiver);
      emit(state, { type: "pass", side: passer.side, playerId: passer.id, receiverId: action.receiver.id });
    }
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
  emit(state, { type: "pass_astray", side: passer.side, playerId: passer.id });
  placeBall(state, scatter(state, action.kind === "through" ? action.target : action.receiver.pos, 4, 10), passer.side);
}

export function resolveShot(state: MatchState, shooter: MatchPlayer, xg: number, kind: ShotKind): void {
  const side = shooter.side;
  const goal = attackingGoal(side);
  const keeper = keeperOf(state, opponent(side));
  state.xg[side] += xg;
  const shot = (outcome: "goal" | "saved" | "off_target" | "blocked") =>
    emit(state, { type: "shot", side, playerId: shooter.id, xg, outcome, keeperId: keeper?.id, kind });

  // Open-play shots can be blocked; set-piece shots already allow for the wall
  const blockers =
    kind === "open_play"
      ? opponents(state, shooter).filter((o) => o.position !== "GK" && distToSegment(o.pos, shooter.pos, goal) < BLOCK_RANGE)
      : [];
  if (blockers.some(() => state.rng() < BLOCK_CHANCE)) {
    shot("blocked");
    if (state.rng() < BLOCK_FOR_CORNER) {
      behindGoalLine(state, side, shooter.pos);
      return;
    }
    const towardGoal = normalize(sub(goal, shooter.pos));
    placeBall(state, scatter(state, add(shooter.pos, scale(towardGoal, 3)), 1, 4), opponent(side));
    return;
  }

  // A penalty either goes in, is saved, or misses; the others go through on-target then keeper
  let scored: boolean;
  let onTarget: boolean;
  if (kind === "penalty") {
    scored = state.rng() < xg;
    onTarget = scored || state.rng() < 0.6;
  } else {
    const onTargetChance = ON_TARGET_BASE + ON_TARGET_SKILL * shooter.attributes.shooting;
    onTarget = state.rng() < onTargetChance;
    // The keeper's ability scales the chance it beats them (1.0 for an average keeper)
    const keeperFactor = 1 - KEEPER_SKILL * ((keeper?.attributes.goalkeeping ?? 1) - 10);
    scored = onTarget && state.rng() < clamp((xg / onTargetChance) * keeperFactor, 0, 0.95);
  }

  if (scored) {
    shot("goal");
    state.score[side]++;
    state.stoppage += ADDED.goal;
    kickoff(state, opponent(side), GOAL_CELEBRATION_TICKS);
    return;
  }
  if (!onTarget) {
    shot("off_target");
    goalKick(state, opponent(side));
    return;
  }

  shot("saved");
  if (keeper && state.rng() < KEEPER_HOLD) {
    giveBall(state, keeper, KEEPER_HOLD_TICKS);
  } else if (state.rng() < PARRY_FOR_CORNER) {
    behindGoalLine(state, side, shooter.pos);
  } else {
    // Parried back into play in front of goal
    const ownGoalPos = ownGoal(opponent(side));
    const outward = normalize(sub(shooter.pos, ownGoalPos));
    placeBall(state, scatter(state, add(ownGoalPos, scale(outward, 8)), 1, 5), opponent(side));
  }
}

// Delivered, claimed by the keeper, headed clear, or won and headed at goal
function resolveCross(state: MatchState, crosser: MatchPlayer, action: Action & { kind: "cross" }): void {
  const { target } = action;
  const cross = (outcome: "blocked" | "overhit" | "claimed" | "cleared" | "won") =>
    emit(state, { type: "cross", side: crosser.side, playerId: crosser.id, targetId: target.id, outcome });

  // Charged down by whoever is closing the crosser, often behind for a corner
  const closer = nearest(opponents(state, crosser), crosser.pos);
  if (state.ball.setPiece !== "corner" && closer && dist(closer.pos, crosser.pos) < CROSS_BLOCK_RANGE && state.rng() < CROSS_BLOCK) {
    cross("blocked");
    if (state.rng() < CROSS_BLOCK_FOR_CORNER) behindGoalLine(state, crosser.side, crosser.pos);
    else placeBall(state, scatter(state, crosser.pos, 2, 6), closer.side);
    return;
  }

  if (state.rng() > action.delivery) {
    cross("overhit");
    placeBall(state, scatter(state, target.pos, 5, 15), crosser.side);
    return;
  }
  const keeper = keeperOf(state, opponent(crosser.side));
  if (keeper && state.rng() < action.claim) {
    cross("claimed");
    giveBall(state, keeper, KEEPER_HOLD_TICKS);
    return;
  }
  if (state.rng() < action.duel) {
    cross("won");
    resolveShot(state, target, action.xg, "header");
    return;
  }
  cross("cleared");
  // Headed away from goal, or only as far as behind for a corner
  if (state.rng() < HEADED_BEHIND) {
    behindGoalLine(state, crosser.side, target.pos);
    return;
  }
  const clearer = action.defender ?? target;
  const away = normalize(sub(clearer.pos, attackingGoal(crosser.side)));
  placeBall(state, scatter(state, add(clearer.pos, scale(away, 18)), 0, 12), opponent(crosser.side));
}

function resolveDribble(state: MatchState, carrier: MatchPlayer, action: Action & { kind: "dribble" }): void {
  const { defender } = action;
  if (state.rng() < action.beat) {
    tire(carrier, dist(carrier.pos, action.to));
    carrier.pos = action.to;
    giveBall(state, carrier, 1);
    if (defender) defender.cooldown = TACKLE_COOLDOWN;
    emit(state, { type: "dribble", side: carrier.side, playerId: carrier.id, defenderId: defender?.id ?? null });
    // Beaten defenders sometimes pull their man back rather than let him go
    const care = (inBox(carrier.side, carrier.pos) ? BOX_FOUL_FACTOR : 1) * (defender?.yellow ? BOOKED_CAUTION : 1);
    if (defender && defender.position !== "GK" && state.rng() < TACTICAL_FOUL * care) judgeFoul(state, defender, carrier, true);
    return;
  }
  if (defender) {
    carrier.cooldown = TACKLE_COOLDOWN;
    giveBall(state, defender);
    emit(state, { type: "tackle", side: defender.side, playerId: defender.id, carrierId: carrier.id, won: true });
  } else {
    // Heavy touch with nobody around
    placeBall(state, action.to, carrier.side);
  }
}

function resolveClear(state: MatchState, carrier: MatchPlayer, action: Action & { kind: "clear" }): void {
  emit(state, { type: "clearance", side: carrier.side, playerId: carrier.id });
  placeBall(state, scatter(state, clearanceTarget(carrier, action.distance), 0, 12), carrier.side);
}

export function act(state: MatchState, carrier: MatchPlayer, action: Action): void {
  switch (action.kind) {
    case "pass":
    case "through":
      return resolvePass(state, carrier, action);
    case "shoot":
      return resolveShot(state, carrier, action.xg, action.shot);
    case "cross":
      return resolveCross(state, carrier, action);
    case "dribble":
      return resolveDribble(state, carrier, action);
    case "clear":
      return resolveClear(state, carrier, action);
  }
}

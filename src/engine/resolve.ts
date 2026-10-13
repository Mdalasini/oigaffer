import {
  BLOCK_CHANCE,
  BLOCK_FOR_CORNER,
  BLOCK_RANGE,
  BOOKED_CAUTION,
  BOX_FOUL_FACTOR,
  CROSS_BLOCK,
  CROSS_BLOCK_FOR_CORNER,
  CROSS_BLOCK_RANGE,
  PASS_ERROR_RADIUS,
  WIDE_PASS_ERROR_RANGE,
  WIDE_PASS_ERROR_SPREAD,
  DRIVEN_PASS_DISTANCE,
  HEADER_HEIGHT,
  SHOT_MISS_WIDTH,
  HEADED_BEHIND,
  TACKLE_LOOSE,
  TACKLE_LOOSE_DISTANCE,
  FOUL_ON_FAILED_TACKLE,
  FOUL_TACKLING_SKILL,
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
  TACKLE_STRENGTH,
  TACTICAL_FOUL,
} from "./constants";
import { clearanceTarget, type Action } from "./decide";
import { launchFlight } from "./flight";
import { add, dist, distToSegment, normalize, PITCH_LENGTH, PITCH_WIDTH, scale, sub, type Vec } from "./geometry";
import { flaggedOffside, judgeFoul } from "./referee";
import { inBox, placeBall } from "./restarts";
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
  type EventPayload,
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

// Deflections travel to the nearest point of the goal line, not its centre.
function goalLine(attacking: Side, near: Vec): Vec {
  return toTeamFrame(attacking, { x: PITCH_LENGTH, y: clamp(toTeamFrame(attacking, near).y, 0, PITCH_WIDTH) });
}

// The nearest defender to the carrier may try to win the ball before they act.
// Keepers holding the ball can't be tackled, and nobody tackles at a dead ball.
// A mistimed challenge can be a foul.
export function attemptTackle(state: MatchState, carrier: MatchPlayer): boolean {
  if (state.ball.flight || carrier.position === "GK" || ballDead(state) || state.ball.setPiece !== null) return false;
  const ready = opponents(state, carrier).filter((o) => o.cooldown === 0 && o.position !== "GK");
  const tackler = nearest(ready, carrier.pos);
  if (!tackler || dist(tackler.pos, carrier.pos) > TACKLE_RANGE) return false;
  if (state.rng() > TACKLE_ATTEMPT) return false;

  tackler.cooldown = TACKLE_COOLDOWN;
  const winChance = clamp(
    TACKLE_BASE + TACKLE_SKILL * (challengeSkill(tackler) - carrier.attributes.dribbling) +
      TACKLE_STRENGTH * (tackler.attributes.strength - carrier.attributes.strength),
    0.1,
    0.8,
  );
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
  // Offside and interception geometry are judged at launch, not after players move.
  const kind = state.ball.setPiece;
  const exempt = kind === "throw_in" || kind === "goal_kick" || kind === "corner";
  const offside = !exempt && flaggedOffside(state, action.receiver);
  const receiverSpot = { ...action.receiver.pos };
  const flightKind = action.kind === "through" ? "through"
    : dist(passer.pos, receiverSpot) >= DRIVEN_PASS_DISTANCE ? "driven" : "pass";

  if (state.rng() < action.success) {
    if (offside) {
      launchFlight(state, flightKind, receiverSpot, { type: "offside", side: passer.side }, [action.receiver.id], 0,
        [{ type: "offside", side: passer.side, playerId: action.receiver.id, passerId: passer.id }]);
    } else if (action.kind === "through") {
      const landing = scatter(state, action.target, 0, 3);
      launchFlight(state, flightKind, landing, { type: "loose", side: passer.side, runnerId: action.receiver.id }, [action.receiver.id], 0,
        [{ type: "through_ball", side: passer.side, playerId: passer.id, receiverId: action.receiver.id }]);
    } else {
      launchFlight(state, flightKind, receiverSpot, { type: "receive", playerId: action.receiver.id }, [action.receiver.id], 0,
        [{ type: "pass", side: passer.side, playerId: passer.id, receiverId: action.receiver.id }]);
    }
    return;
  }

  const totalRisk = action.risks.reduce((s, r) => s + r.risk, 0);
  const failure = 1 - action.success;
  if (totalRisk > 0 && state.rng() < Math.min(1, totalRisk / failure)) {
    let roll = state.rng() * totalRisk;
    const interceptor = action.risks.find((r) => (roll -= r.risk) <= 0)?.player ?? action.risks[0]!.player;
    launchFlight(state, flightKind, interceptor.pos, { type: "receive", playerId: interceptor.id }, [interceptor.id], 0,
      [{ type: "interception", side: interceptor.side, playerId: passer.id, interceptorId: interceptor.id }]);
    return;
  }
  const intended = action.kind === "through" ? action.target : receiverSpot;
  const wide = Math.min(intended.y, PITCH_WIDTH - intended.y) < WIDE_PASS_ERROR_RANGE;
  // Wide outlets are often overrun rather than knocked back infield. Preserve
  // the struck lane for these errors; central mis-hits can still go either way.
  const angle = wide
    ? Math.atan2(intended.y - passer.pos.y, intended.x - passer.pos.x) + (state.rng() * 2 - 1) * WIDE_PASS_ERROR_SPREAD
    : state.rng() * Math.PI * 2;
  const [lo, hi] = PASS_ERROR_RADIUS;
  const error = lo + state.rng() * (hi - lo);
  const landing = { x: intended.x + Math.cos(angle) * error, y: intended.y + Math.sin(angle) * error };
  launchFlight(state, flightKind, landing, { type: "loose", side: passer.side, runnerId: null }, [], 0,
    [{ type: "pass_astray", side: passer.side, playerId: passer.id }]);
}

export function resolveShot(state: MatchState, shooter: MatchPlayer, xg: number, kind: ShotKind): void {
  const side = shooter.side;
  const goal = attackingGoal(side);
  const keeper = keeperOf(state, opponent(side));
  const shooterSpot = { ...shooter.pos };
  const shot = (outcome: "goal" | "saved" | "off_target" | "blocked"): EventPayload[] =>
    [{ type: "shot", side, playerId: shooter.id, xg, outcome, ...(keeper ? { keeperId: keeper.id } : {}), kind }];

  // Open-play shots can be blocked; set-piece shots already allow for the wall
  const blockers =
    kind === "open_play"
      ? opponents(state, shooter).filter((o) => o.position !== "GK" && distToSegment(o.pos, shooter.pos, goal) < BLOCK_RANGE)
      : [];
  if (blockers.some(() => state.rng() < BLOCK_CHANCE)) {
    if (state.rng() < BLOCK_FOR_CORNER) {
      launchFlight(state, "shot", goalLine(side, shooterSpot), { type: "corner", side }, [], 0, shot("blocked"));
      return;
    }
    const towardGoal = normalize(sub(goal, shooterSpot));
    const landing = scatter(state, add(shooterSpot, scale(towardGoal, 3)), 1, 4);
    launchFlight(state, "shot", landing, { type: "loose", side: opponent(side), runnerId: null }, [], 0, shot("blocked"));
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
    launchFlight(state, "shot", goal, { type: "goal", side }, keeper ? [keeper.id] : [], 0, shot("goal"));
    return;
  }
  if (!onTarget) {
    const miss = { ...goal, y: goal.y + (shooterSpot.y < goal.y ? -SHOT_MISS_WIDTH : SHOT_MISS_WIDTH) };
    launchFlight(state, "shot", miss, { type: "goal_kick", side: opponent(side) }, [], 0, shot("off_target"));
    return;
  }

  if (keeper && state.rng() < KEEPER_HOLD) {
    launchFlight(state, "shot", keeper.pos, { type: "receive", playerId: keeper.id, controlTicks: KEEPER_HOLD_TICKS }, [keeper.id], 0, shot("saved"));
  } else if (state.rng() < PARRY_FOR_CORNER) {
    launchFlight(state, "shot", goalLine(side, shooterSpot), { type: "corner", side }, keeper ? [keeper.id] : [], 0, shot("saved"));
  } else {
    const ownGoalPos = ownGoal(opponent(side));
    const outward = normalize(sub(shooterSpot, ownGoalPos));
    const landing = scatter(state, add(ownGoalPos, scale(outward, 8)), 1, 5);
    launchFlight(state, "shot", goal, {
      type: "follow_on", kind: "pass", destination: landing,
      arrival: { type: "loose", side: opponent(side), runnerId: null },
    }, keeper ? [keeper.id] : [], 0, shot("saved"));
  }
}

// Delivered, claimed by the keeper, headed clear, or won and headed at goal
function resolveCross(state: MatchState, crosser: MatchPlayer, action: Action & { kind: "cross" }): void {
  const { target } = action;
  const targetSpot = { ...target.pos };
  const crosserSpot = { ...crosser.pos };
  const offside = state.ball.setPiece !== "corner" && flaggedOffside(state, target);
  const cross = (outcome: "blocked" | "overhit" | "claimed" | "cleared" | "won"): EventPayload[] =>
    [{ type: "cross", side: crosser.side, playerId: crosser.id, targetId: target.id, outcome }];

  // Charged down by whoever is closing the crosser, often behind for a corner
  const closer = nearest(opponents(state, crosser), crosser.pos);
  if (state.ball.setPiece !== "corner" && closer && dist(closer.pos, crosser.pos) < CROSS_BLOCK_RANGE && state.rng() < CROSS_BLOCK) {
    if (state.rng() < CROSS_BLOCK_FOR_CORNER) {
      launchFlight(state, "cross", goalLine(crosser.side, crosserSpot), { type: "corner", side: crosser.side }, [], 0, cross("blocked"));
    } else {
      const landing = scatter(state, crosserSpot, 2, 6);
      launchFlight(state, "cross", landing, { type: "loose", side: closer.side, runnerId: null }, [], 0, cross("blocked"));
    }
    return;
  }

  if (state.rng() > action.delivery) {
    const landing = scatter(state, targetSpot, 5, 15);
    launchFlight(state, "cross", landing, { type: "loose", side: crosser.side, runnerId: null }, [], 0, cross("overhit"));
    return;
  }
  if (offside) {
    launchFlight(state, "cross", targetSpot, { type: "offside", side: crosser.side }, [target.id], 0,
      [{ type: "offside", side: crosser.side, playerId: target.id, passerId: crosser.id }]);
    return;
  }
  const keeper = keeperOf(state, opponent(crosser.side));
  if (keeper && state.rng() < action.claim) {
    launchFlight(state, "cross", targetSpot, { type: "receive", playerId: keeper.id, controlTicks: KEEPER_HOLD_TICKS }, [keeper.id], 0, cross("claimed"));
    return;
  }
  if (state.rng() < action.duel) {
    launchFlight(state, "cross", targetSpot, { type: "header", playerId: target.id, xg: action.xg }, [target.id], HEADER_HEIGHT, cross("won"));
    return;
  }
  const clearer = action.defender ?? target;
  if (state.rng() < HEADED_BEHIND) {
    launchFlight(state, "cross", targetSpot, {
      type: "follow_on", kind: "clearance", destination: goalLine(crosser.side, targetSpot),
      arrival: { type: "corner", side: crosser.side },
    }, [clearer.id], HEADER_HEIGHT, cross("cleared"));
    return;
  }
  const away = normalize(sub(clearer.pos, attackingGoal(crosser.side)));
  const landing = scatter(state, add(clearer.pos, scale(away, 18)), 0, 12);
  launchFlight(state, "cross", targetSpot, {
    type: "follow_on", kind: "clearance", destination: landing,
    arrival: { type: "loose", side: opponent(crosser.side), runnerId: null },
  }, [clearer.id], HEADER_HEIGHT, cross("cleared"));
}

function resolveDribble(state: MatchState, carrier: MatchPlayer, action: Action & { kind: "dribble" }): void {
  const { defender } = action;
  if (state.rng() < action.beat) {
    giveBall(state, carrier, 1);
    carrier.carryTarget = action.to;
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
  const landing = scatter(state, clearanceTarget(carrier, action.distance), 0, 12);
  launchFlight(state, "clearance", landing, { type: "loose", side: carrier.side, runnerId: null }, [], 0,
    [{ type: "clearance", side: carrier.side, playerId: carrier.id }]);
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

import {
  CONTROL_RADIUS,
  CARRIER_JOG_SPEED,
  FIRST_TOUCH_SPEED,
  POOR_TOUCH_CHANCE,
  POOR_TOUCH_DISTANCE,
  PRESSURE_RANGE,
  TOUCH_ESCAPE_RANGE,
  TOUCH_ESCAPE_WEIGHT,
  TOUCH_SKILL_MAX,
  BOX_DEPTH,
  PENALTY_EDGE_MARGIN,
  COVER_DROP,
  KEEPER_BOX,
  KEEPER_SPEED,
  MARK_DISTANCE,
  MARK_HALF_MARGIN,
  MARK_RANGE,
  MOVE_SPEED,
  PRESS_SPEED,
  PRESS_STAND_OFF,
  PRESS_TRIGGER,
  OFFSIDE_GAMBLE,
  OFFSIDE_GAMBLE_CHANCE,
  RUN_SPEED,
  THROW_IN_DISTANCE,
  WALL_DISTANCE,
  RESTART_DISTANCE_EPSILON,
  STEER_RESTART_MARGIN,
  STEER_ACCEL,
  STEER_CLOSE_ACCEL,
  STEER_ANTICIPATION,
  STEER_DEFEND_ACCEL,
  STEER_FACE_SPEED,
} from "./constants";
import { movementBuffer, restartRadiusFor, separateBodies, separation, steerPlayer } from "./steering";
import { anchor, keeperPosition, kickoffPosition } from "./formation";
import { add, CENTRE, clampToPitch, dist, distSq, normalize, PITCH_LENGTH, PITCH_WIDTH, REJECT_MARGIN, scale, sub, type Vec } from "./geometry";
import { moveReferee, offsideLine } from "./referee";
import { cornerPosition, placeBall } from "./restarts";
import {
  ballDead,
  emit,
  fromTeamFrame,
  giveBall,
  nearest,
  opponent,
  opponents,
  owner,
  ownGoal,
  toTeamFrame,
  type MatchPlayer,
  type MatchState,
  type Side,
} from "./state";

// Who goes for the ball. With a loose ball, the nearest player on each side chases it.
// Against a carrier, the nearest defender presses only if the ball has come into
// their zone; otherwise the defence holds its shape. Keepers only come out inside their box.
function chasers(state: MatchState): Set<MatchPlayer> {
  const carrier = owner(state);
  // Nobody closes down a restart
  if (ballDead(state)) return new Set();
  if (state.ball.flight) {
    const flight = state.ball.flight;
    const result = new Set(state.players.filter((p) => flight.meetIds.includes(p.id)));
    // Receivers of rolled completions own the landing spot. Loose deliveries still
    // provoke a race, but nobody can collect them before the scheduled arrival.
    if (flight.kind === "through" || flight.kind === "clearance" || flight.meetIds.length === 0) {
      for (const side of ["home", "away"] as const) {
        const candidates = state.players.filter((p) => p.side === side &&
          (p.position !== "GK" || dist(flight.destination, ownGoal(side)) < KEEPER_BOX));
        const chaser = nearest(candidates, flight.destination);
        if (chaser) result.add(chaser);
      }
    }
    return result;
  }
  const sides: Side[] = carrier ? [opponent(carrier.side)] : ["home", "away"];
  const result = new Set<MatchPlayer>();
  for (const side of sides) {
    const keeperCanCome = dist(state.ball.pos, ownGoal(side)) < KEEPER_BOX;
    // Forwards stay up as an outlet rather than pressing; they still chase loose balls
    const candidates: MatchPlayer[] = [];
    for (const p of state.players) {
      if (p.side === side && p.cooldown === 0 && (p.position !== "GK" || keeperCanCome) && (p.position !== "FWD" || !carrier)) {
        candidates.push(p);
      }
    }
    // A through ball's runner goes for it rather than whoever happens to be nearest
    const runner = !carrier ? candidates.find((p) => p.id === state.ball.runnerId) : undefined;
    const chaser = runner ?? nearest(candidates, state.ball.pos);
    if (!chaser) continue;
    const inZone = dist(anchor(state, chaser, false), state.ball.pos) < PRESS_TRIGGER;
    if (!carrier || inZone || chaser.position === "GK") result.add(chaser);
  }
  return result;
}

// Goal-side marking (the book's "interpose"): each free defender picks up the closest
// attacker near their zone in their own half, nearest pairs first, one attacker each.
function markingTargets(state: MatchState, defending: Side, busy: Set<MatchPlayer>): Map<MatchPlayer, Vec> {
  const goal = ownGoal(defending);
  // Same test as toTeamFrame(defending, p.pos).x, without allocating a point per player
  const flip = defending !== "home";
  const attackers: MatchPlayer[] = [];
  const markers: MatchPlayer[] = [];
  for (const p of state.players) {
    if (p.side !== defending && p.position !== "GK" && p.id !== state.ball.ownerId &&
      (flip ? PITCH_LENGTH - p.pos.x : p.pos.x) < CENTRE.x + MARK_HALF_MARGIN) attackers.push(p);
    if (p.side === defending && p.position !== "GK" && !busy.has(p)) markers.push(p);
  }

  if (markers.length === 0 || attackers.length === 0) return new Map();

  const pairs: { marker: MatchPlayer; attacker: MatchPlayer; d: number }[] = [];
  for (const marker of markers) {
    const home = anchor(state, marker, false);
    for (const attacker of attackers) {
      if (distSq(home, attacker.pos) > MARK_RANGE * MARK_RANGE * REJECT_MARGIN) continue;
      const d = dist(home, attacker.pos);
      if (d < MARK_RANGE) pairs.push({ marker, attacker, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);

  const targets = new Map<MatchPlayer, Vec>();
  const taken = new Set<MatchPlayer>();
  for (const { marker, attacker } of pairs) {
    if (targets.has(marker) || taken.has(attacker)) continue;
    targets.set(marker, add(attacker.pos, scale(normalize(sub(goal, attacker.pos)), MARK_DISTANCE)));
    taken.add(attacker);
  }
  return targets;
}

// Protect a receiving touch, then carry while looking up. This is not a take-on.
export function moveCarrier(state: MatchState, carrier: MatchPlayer): void {
  if (state.ball.setPiece !== null) return;
  if (carrier.carryTarget) {
    // A committed take-on is a burst, not the restrained touch/look-up carry.
    steerPlayer(carrier, carrier.carryTarget, RUN_SPEED, 0, state.ball.pos, 0, 0, STEER_CLOSE_ACCEL);
    delete carrier.carryTarget;
    state.ball.pos = { x: carrier.pos.x, y: carrier.pos.y };
    return;
  }
  if (!state.ball.receiving || carrier.position === "GK" || state.time >= state.ball.readyAt) {
    steerPlayer(carrier, carrier.pos, 0, 0, state.ball.pos);
    state.ball.pos = { x: carrier.pos.x, y: carrier.pos.y };
    return;
  }
  const defender = nearest(opponents(state, carrier), carrier.pos);
  const distance = defender ? dist(defender.pos, carrier.pos) : Infinity;
  // Control and look-up follow the receiving run, not an automatic take-on
  // towards goal. Deliberate forward bursts belong to the dribble decision.
  const momentum = Math.hypot(carrier.vel.x, carrier.vel.y);
  const runDirection = momentum > STEER_FACE_SPEED ? normalize(carrier.vel) :
    { x: 0, y: carrier.pos.y < PITCH_WIDTH / 2 ? 1 : -1 };
  const escape = defender && distance > 0 ? normalize(sub(carrier.pos, defender.pos)) : { x: -runDirection.y, y: runDirection.x };
  const weight = TOUCH_ESCAPE_WEIGHT * Math.max(0, 1 - distance / TOUCH_ESCAPE_RANGE);
  const direction = normalize(add(runDirection, scale(escape, weight)));
  if (state.ball.pendingTouch) {
    state.ball.pendingTouch = false;
    const skill = (carrier.attributes.passing + carrier.attributes.dribbling) / 2;
    const risk = POOR_TOUCH_CHANCE * Math.max(0, 1 - distance / PRESSURE_RANGE) *
      Math.max(0, (TOUCH_SKILL_MAX - skill) / (TOUCH_SKILL_MAX - 1));
    if (risk > 0 && state.rng() < risk) {
      placeBall(state, add(carrier.pos, scale(direction, POOR_TOUCH_DISTANCE)), carrier.side);
      return;
    }
  }
  const speed = state.time < state.ball.controlledAt ? FIRST_TOUCH_SPEED : CARRIER_JOG_SPEED;
  // Aim beyond this tick's displacement so arrival slowing does not turn a jog into a walk.
  steerPlayer(carrier, add(carrier.pos, scale(direction, RUN_SPEED)), speed, 0, state.ball.pos);
  state.ball.pos = { x: carrier.pos.x, y: carrier.pos.y };
}

export function moveOffBall(state: MatchState): void {
  // Every off-ball target must see the same ball position, not a partial update
  // dependent on which side's carrier appears first in the player array.
  const previousCarrier = owner(state);
  if (previousCarrier) moveCarrier(state, previousCarrier);
  const carrier = owner(state);
  const possessionSide = carrier?.side ?? state.ball.lastSide;
  const chasing = chasers(state);
  const marking = markingTargets(state, opponent(possessionSide), chasing);
  const onside = offsideLine(state, possessionSide);

  const buffer = movementBuffer(state);
  separation(state, buffer);
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i]!;
    if (p === carrier) {
      if (state.ball.setPiece !== null) steerPlayer(p, state.ball.pos, MOVE_SPEED, 0, state.ball.pos);
      continue;
    }
    let target: Vec;
    let speed: number;
    let standOff = 0;
    const setPieceSpot = cornerPosition(state, p);
    // Membership cannot change inside this loop, so look each player up once
    const isChasing = chasing.has(p), isMarking = marking.has(p);
    if (state.ball.setPiece === "kickoff") {
      target = kickoffPosition(p);
      speed = MOVE_SPEED;
    } else if (state.ball.setPiece === "penalty" && carrier) {
      if (p.side !== carrier.side && p.position === "GK") {
        target = ownGoal(p.side);
      } else {
        const normal = toTeamFrame(carrier.side, anchor(state, p, p.side === possessionSide));
        target = fromTeamFrame(carrier.side, {
          x: Math.min(normal.x, PITCH_LENGTH - BOX_DEPTH - PENALTY_EDGE_MARGIN), y: normal.y,
        });
      }
      speed = MOVE_SPEED;
    } else if (setPieceSpot) {
      target = setPieceSpot;
      speed = MOVE_SPEED;
    } else if (isChasing) {
      target = state.ball.flight?.destination ?? state.ball.pos;
      speed = p.id === state.ball.runnerId || state.ball.flight?.meetIds.includes(p.id) ? RUN_SPEED : PRESS_SPEED;
      if (carrier) {
        target = add(target, scale(carrier.vel, STEER_ANTICIPATION));
        standOff = PRESS_STAND_OFF;
      }
    } else if (p.position === "GK") {
      target = keeperPosition(state, p);
      speed = KEEPER_SPEED;
    } else if (isMarking) {
      target = marking.get(p)!;
      speed = MOVE_SPEED;
    } else {
      target = anchor(state, p, p.side === possessionSide);
      // Frame conversions are written out as scalars (same operations as toTeamFrame) to avoid allocating per player
      const flip = p.side !== "home";
      if (p.side !== possessionSide && p.position === "DEF") {
        // A spare defender covers the space behind the line
        const tx = flip ? PITCH_LENGTH - target.x : target.x;
        const ty = flip ? PITCH_WIDTH - target.y : target.y;
        const x = Math.max(tx - COVER_DROP, 6);
        target = { x: flip ? PITCH_LENGTH - x : x, y: flip ? PITCH_WIDTH - ty : ty };
      }
      if (p.side === possessionSide) {
        // Stay onside; forwards play right on the shoulder of the last defender,
        // and now and then gamble on a run a little too early
        const tx = flip ? PITCH_LENGTH - target.x : target.x;
        const ty = flip ? PITCH_WIDTH - target.y : target.y;
        const gamble = state.rng() < OFFSIDE_GAMBLE_CHANCE ? state.rng() * OFFSIDE_GAMBLE : 0;
        const x = p.position === "FWD" ? onside - 1 + gamble : Math.min(tx, onside);
        const ux = flip ? PITCH_LENGTH - x : x, uy = flip ? PITCH_WIDTH - ty : ty;
        target = { x: Math.min(PITCH_LENGTH, Math.max(0, ux)), y: Math.min(PITCH_WIDTH, Math.max(0, uy)) };
      }
      speed = MOVE_SPEED;
    }
    if (carrier && state.ball.setPiece !== null) {
      target = keepDistance(state, carrier, p, target);
      speed = MOVE_SPEED;
    }
    buffer.orders[i * 5] = target.x;
    buffer.orders[i * 5 + 1] = target.y;
    buffer.orders[i * 5 + 2] = speed;
    buffer.orders[i * 5 + 3] = standOff;
    // Retreating defenders and midfield cover must not lag behind their shape.
    const defendingLine = (p.position === "DEF" || p.position === "MID") && p.side !== possessionSide;
    buffer.orders[i * 5 + 4] = isChasing || isMarking ? STEER_CLOSE_ACCEL :
      defendingLine ? STEER_DEFEND_ACCEL : STEER_ACCEL;
  }
  // All targets are chosen before any off-ball player moves.
  const target = { x: 0, y: 0 };
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i]!;
    if (p === carrier) continue;
    target.x = buffer.orders[i * 5]!;
    target.y = buffer.orders[i * 5 + 1]!;
    steerPlayer(p, target, buffer.orders[i * 5 + 2]!, buffer.orders[i * 5 + 3]!, state.ball.pos,
      buffer.separation[i * 2]!, buffer.separation[i * 2 + 1]!, buffer.orders[i * 5 + 4]!, restartRadiusFor(state, carrier, p));
  }
  separateBodies(state);
  if (carrier && state.ball.setPiece === null) state.ball.pos = { x: carrier.pos.x, y: carrier.pos.y };
  moveReferee(state);
}

// Opponents have to stand back from a restart
function keepDistance(state: MatchState, taker: MatchPlayer, p: MatchPlayer, target: Vec): Vec {
  const kind = state.ball.setPiece;
  if (kind === "penalty") {
    if (p.side !== taker.side && p.position === "GK") return target;
    if (dist(target, state.ball.pos) >= WALL_DISTANCE) return target;
    return add(state.ball.pos, scale(normalize(sub(target, state.ball.pos)), WALL_DISTANCE + STEER_RESTART_MARGIN));
  }
  if (p.side === taker.side) return target;
  const required = (kind === "throw_in" ? THROW_IN_DISTANCE : WALL_DISTANCE) + STEER_RESTART_MARGIN;
  // Escape to the nearest legal point first, rather than taking a second movement step.
  const point = dist(p.pos, state.ball.pos) < required - RESTART_DISTANCE_EPSILON ? p.pos : target;
  if (dist(point, state.ball.pos) >= required) return target;
  let away = normalize(sub(point, state.ball.pos));
  if (dist(point, state.ball.pos) === 0) away = normalize(sub(ownGoal(p.side), state.ball.pos));
  return clampToPitch(add(state.ball.pos, scale(away, required)));
}

// A loose ball goes to whoever reaches it. If both sides get there,
// the closest player from each side contests it 50/50.
export function pickUpLooseBall(state: MatchState): void {
  if (state.ball.flight) return;
  const reachSq = CONTROL_RADIUS * CONTROL_RADIUS * REJECT_MARGIN;
  const inReach = state.players.filter((p) => distSq(p.pos, state.ball.pos) <= reachSq && dist(p.pos, state.ball.pos) <= CONTROL_RADIUS);
  const contenders = (["home", "away"] as const)
    .map((side) => nearest(inReach.filter((p) => p.side === side), state.ball.pos))
    .filter((p) => p !== undefined);
  if (contenders.length === 0) return;
  const taker = contenders[Math.floor(state.rng() * contenders.length)]!;
  // A runner collecting a ball played into space is already moving and can go again straight away
  const onTheRun = taker.id === state.ball.runnerId;
  giveBall(state, taker, onTheRun ? 1 : undefined);
  emit(state, { type: "recovery", side: taker.side, playerId: taker.id });
}

import {
  CONTROL_RADIUS,
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
} from "./constants";
import { speedFactor, tire } from "./fatigue";
import { anchor, keeperPosition } from "./formation";
import { add, CENTRE, clampToPitch, dist, moveTowards, normalize, scale, sub, type Vec } from "./geometry";
import { moveReferee, offsideLine } from "./referee";
import { cornerPosition } from "./restarts";
import {
  ballDead,
  emit,
  giveBall,
  nearest,
  opponent,
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
  const sides: Side[] = carrier ? [opponent(carrier.side)] : ["home", "away"];
  const result = new Set<MatchPlayer>();
  for (const side of sides) {
    const keeperCanCome = dist(state.ball.pos, ownGoal(side)) < KEEPER_BOX;
    // Forwards stay up as an outlet rather than pressing; they still chase loose balls
    const candidates = state.players.filter(
      (p) =>
        p.side === side &&
        p.cooldown === 0 &&
        (p.position !== "GK" || keeperCanCome) &&
        (p.position !== "FWD" || !carrier),
    );
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
  const attackers = state.players.filter(
    (p) =>
      p.side !== defending &&
      p.position !== "GK" &&
      p.id !== state.ball.ownerId &&
      toTeamFrame(defending, p.pos).x < CENTRE.x + MARK_HALF_MARGIN,
  );
  const markers = state.players.filter((p) => p.side === defending && p.position !== "GK" && !busy.has(p));

  const pairs: { marker: MatchPlayer; attacker: MatchPlayer; d: number }[] = [];
  for (const marker of markers) {
    const home = anchor(state, marker, false);
    for (const attacker of attackers) {
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

export function moveOffBall(state: MatchState): void {
  const carrier = owner(state);
  const possessionSide = carrier?.side ?? state.ball.lastSide;
  const chasing = chasers(state);
  const marking = markingTargets(state, opponent(possessionSide), chasing);
  const onside = offsideLine(state, possessionSide);

  for (const p of state.players) {
    if (p === carrier) continue;
    let target: Vec;
    let speed: number;
    let standOff = 0;
    const setPieceSpot = cornerPosition(state, p);
    if (setPieceSpot) {
      target = setPieceSpot;
      speed = MOVE_SPEED;
    } else if (chasing.has(p)) {
      target = state.ball.pos;
      speed = p.id === state.ball.runnerId ? RUN_SPEED : PRESS_SPEED;
      if (carrier) standOff = PRESS_STAND_OFF;
    } else if (p.position === "GK") {
      target = keeperPosition(state, p);
      speed = KEEPER_SPEED;
    } else if (marking.has(p)) {
      target = marking.get(p)!;
      speed = MOVE_SPEED;
    } else {
      target = anchor(state, p, p.side === possessionSide);
      if (p.side !== possessionSide && p.position === "DEF") {
        // A spare defender covers the space behind the line
        const t = toTeamFrame(p.side, target);
        target = toTeamFrame(p.side, { x: Math.max(t.x - COVER_DROP, 6), y: t.y });
      }
      if (p.side === possessionSide) {
        // Stay onside; forwards play right on the shoulder of the last defender,
        // and now and then gamble on a run a little too early
        const t = toTeamFrame(p.side, target);
        const gamble = state.rng() < OFFSIDE_GAMBLE_CHANCE ? state.rng() * OFFSIDE_GAMBLE : 0;
        const x = p.position === "FWD" ? onside - 1 + gamble : Math.min(t.x, onside);
        target = toTeamFrame(p.side, { x, y: t.y });
      }
      speed = MOVE_SPEED;
    }
    const from = p.pos;
    p.pos = moveTowards(p.pos, target, speed * speedFactor(p), standOff);
    tire(p, dist(from, p.pos));
  }
  if (carrier && ballDead(state)) keepDistance(state, carrier);
  moveReferee(state);
}

// Opponents have to stand back from a restart
function keepDistance(state: MatchState, taker: MatchPlayer): void {
  const kind = state.ball.setPiece;
  if (kind === "penalty" || kind === "kickoff") return;
  const required = kind === "throw_in" ? THROW_IN_DISTANCE : WALL_DISTANCE;
  for (const p of state.players) {
    if (p.side === taker.side) continue;
    const d = dist(p.pos, state.ball.pos);
    if (d >= required) continue;
    const away = d < 0.01 ? normalize(sub(CENTRE, state.ball.pos)) : normalize(sub(p.pos, state.ball.pos));
    p.pos = clampToPitch(add(state.ball.pos, scale(away, required)));
  }
}

// A loose ball goes to whoever reaches it. If both sides get there,
// the closest player from each side contests it 50/50.
export function pickUpLooseBall(state: MatchState): void {
  const inReach = state.players.filter((p) => dist(p.pos, state.ball.pos) <= CONTROL_RADIUS);
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

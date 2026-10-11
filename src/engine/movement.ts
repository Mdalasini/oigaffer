import { CONTROL_RADIUS, KEEPER_BOX, KEEPER_SPEED, MOVE_SPEED, PRESS_SPEED, PRESS_STAND_OFF, PRESS_TRIGGER } from "./constants";
import { anchor, keeperPosition } from "./formation";
import { dist, moveTowards, type Vec } from "./geometry";
import {
  emit,
  giveBall,
  nearest,
  opponent,
  owner,
  ownGoal,
  type MatchPlayer,
  type MatchState,
  type Side,
} from "./state";

// Who goes for the ball. With a loose ball, the nearest player on each side chases it.
// Against a carrier, the nearest defender presses only if the ball has come into
// their zone; otherwise the defence holds its shape. Keepers only come out inside their box.
function chasers(state: MatchState): Set<MatchPlayer> {
  const carrier = owner(state);
  const sides: Side[] = carrier ? [opponent(carrier.side)] : ["home", "away"];
  const result = new Set<MatchPlayer>();
  for (const side of sides) {
    const keeperCanCome = dist(state.ball.pos, ownGoal(side)) < KEEPER_BOX;
    const candidates = state.players.filter(
      (p) => p.side === side && p.cooldown === 0 && (p.position !== "GK" || keeperCanCome),
    );
    const chaser = nearest(candidates, state.ball.pos);
    if (!chaser) continue;
    const inZone = dist(anchor(state, chaser, false), state.ball.pos) < PRESS_TRIGGER;
    if (!carrier || inZone || chaser.position === "GK") result.add(chaser);
  }
  return result;
}

export function moveOffBall(state: MatchState): void {
  const carrier = owner(state);
  const possessionSide = carrier?.side ?? state.ball.lastSide;
  const chasing = chasers(state);

  for (const p of state.players) {
    if (p === carrier) continue;
    let target: Vec;
    let speed: number;
    let standOff = 0;
    if (chasing.has(p)) {
      target = state.ball.pos;
      speed = PRESS_SPEED;
      if (carrier) standOff = PRESS_STAND_OFF;
    } else if (p.position === "GK") {
      target = keeperPosition(state, p);
      speed = KEEPER_SPEED;
    } else {
      target = anchor(state, p, p.side === possessionSide);
      speed = MOVE_SPEED;
    }
    p.pos = moveTowards(p.pos, target, speed, standOff);
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
  giveBall(state, taker);
  emit(state, { type: "recovery", side: taker.side, playerId: taker.id });
}

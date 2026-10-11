import {
  CLEAR_DISTANCE,
  DECISION_TEMPERATURE,
  DRIBBLE_BASE,
  DRIBBLE_CONTEST_RANGE,
  DRIBBLE_DISTANCE,
  DRIBBLE_FREE,
  DRIBBLE_SKILL,
  KEEPER_KICK_DISTANCE,
  KEEPER_PASS_MAX_DISTANCE,
  LOOSE_BALL_DISCOUNT,
  PASS_MAX_DISTANCE,
  POSSESSION_VALUE,
} from "./constants";
import { add, clampToPitch, dist, dot, normalize, scale, sub, type Vec } from "./geometry";
import {
  attackingGoal,
  challengeSkill,
  nearest,
  opponents,
  teammates,
  type MatchPlayer,
  type MatchState,
} from "./state";
import { assessPass, looseBallWinChance, possessionValue, shotXg, turnoverCost, type InterceptRisk } from "./valuation";

export type Action =
  | { kind: "pass"; receiver: MatchPlayer; success: number; risks: InterceptRisk[] }
  | { kind: "shoot"; xg: number }
  | { kind: "dribble"; to: Vec; beat: number; defender: MatchPlayer | null }
  | { kind: "clear"; distance: number };

export interface Option {
  action: Action;
  utility: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Carry towards goal, veering away from the nearest opponent if one is close
function assessDribble(state: MatchState, carrier: MatchPlayer): Action & { kind: "dribble" } {
  let dir = normalize(sub(attackingGoal(carrier.side), carrier.pos));
  const closest = nearest(opponents(state, carrier), carrier.pos);
  const defender = closest && dist(closest.pos, carrier.pos) < DRIBBLE_CONTEST_RANGE ? closest : null;

  if (defender) {
    const away = sub(carrier.pos, defender.pos);
    const perp = { x: -dir.y, y: dir.x };
    const veer = dot(perp, away) >= 0 ? 0.8 : -0.8;
    dir = normalize(add(dir, scale(perp, veer)));
  }
  const beat = defender
    ? clamp(DRIBBLE_BASE + DRIBBLE_SKILL * (carrier.attributes.dribbling - challengeSkill(defender)), 0.15, 0.9)
    : DRIBBLE_FREE;
  return { kind: "dribble", to: clampToPitch(add(carrier.pos, scale(dir, DRIBBLE_DISTANCE))), beat, defender };
}

// A clearance lands as a 50/50 somewhere upfield
export function clearanceTarget(carrier: MatchPlayer, distance: number): Vec {
  const dir = normalize(sub(attackingGoal(carrier.side), carrier.pos));
  return clampToPitch(add(carrier.pos, scale(dir, distance)));
}

// Every option the ball carrier has, scored in expected-goal units:
// value if it works minus what it costs if it doesn't.
export function scoreOptions(state: MatchState, carrier: MatchPlayer): Option[] {
  const side = carrier.side;
  const isKeeper = carrier.position === "GK";
  const options: Option[] = [];

  const maxPass = isKeeper ? KEEPER_PASS_MAX_DISTANCE : PASS_MAX_DISTANCE;
  for (const mate of teammates(state, carrier)) {
    const d = dist(carrier.pos, mate.pos);
    if (d < 2 || d > maxPass) continue;
    const { success, risks } = assessPass(state, carrier, mate);
    const midpoint = scale(add(carrier.pos, mate.pos), 0.5);
    options.push({
      action: { kind: "pass", receiver: mate, success, risks },
      utility: success * possessionValue(side, mate.pos) - (1 - success) * turnoverCost(side, midpoint),
    });
  }

  const clearDistance = isKeeper ? KEEPER_KICK_DISTANCE : CLEAR_DISTANCE;
  const landing = clearanceTarget(carrier, clearDistance);
  const win = looseBallWinChance(state, carrier, landing);
  options.push({
    action: { kind: "clear", distance: clearDistance },
    utility: win * LOOSE_BALL_DISCOUNT * possessionValue(side, landing) - (1 - win) * turnoverCost(side, landing),
  });

  if (!isKeeper) {
    const xg = shotXg(state, carrier);
    options.push({ action: { kind: "shoot", xg }, utility: xg - (1 - xg) * POSSESSION_VALUE });

    const dribble = assessDribble(state, carrier);
    options.push({
      action: dribble,
      utility: dribble.beat * possessionValue(side, dribble.to) - (1 - dribble.beat) * turnoverCost(side, carrier.pos),
    });
  }
  return options;
}

// Softmax over utilities: usually the best option, sometimes a worse one.
// Better passers choose more sharply.
export function chooseAction(state: MatchState, carrier: MatchPlayer): Action {
  const options = scoreOptions(state, carrier);
  const temperature = DECISION_TEMPERATURE * (1.5 - carrier.attributes.passing / 20);
  const best = Math.max(...options.map((o) => o.utility));
  const weights = options.map((o) => Math.exp((o.utility - best) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);

  let roll = state.rng() * total;
  for (let i = 0; i < options.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return options[i]!.action;
  }
  return options[options.length - 1]!.action;
}

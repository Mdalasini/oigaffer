import {
  CLEAR_DISTANCE,
  DECISION_TEMPERATURE,
  CARRY_DISTANCE,
  DRIBBLE_BASE,
  DRIBBLE_CONTEST_RANGE,
  DRIBBLE_DISTANCE,
  DRIBBLE_FREE,
  DRIBBLE_SKILL,
  KEEPER_KICK_DISTANCE,
  KEEPER_PASS_MAX_DISTANCE,
  LOOSE_BALL_DISCOUNT,
  MENTALITY_RISK,
  PASS_MAX_DISTANCE,
  THROUGH_BALL_LEADS,
  THROUGH_BALL_MAX_DISTANCE,
  POSSESSION_VALUE,
} from "./constants";
import { add, clampToPitch, dist, distToSegment, dot, normalize, scale, sub, type Vec } from "./geometry";
import {
  attackingGoal,
  challengeSkill,
  opponents,
  teammates,
  toTeamFrame,
  type MatchPlayer,
  type MatchState,
} from "./state";
import {
  assessPass,
  looseBallWinChance,
  possessionValue,
  raceWinChance,
  shotXg,
  turnoverCost,
  type InterceptRisk,
} from "./valuation";

export type Action =
  | { kind: "pass"; receiver: MatchPlayer; success: number; risks: InterceptRisk[] }
  | { kind: "through"; receiver: MatchPlayer; target: Vec; success: number; risks: InterceptRisk[] }
  | { kind: "shoot"; xg: number }
  | { kind: "dribble"; to: Vec; beat: number; defender: MatchPlayer | null }
  | { kind: "clear"; distance: number };

export interface Option {
  action: Action;
  utility: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Carry towards goal, veering away from whoever is in the way. Anyone close to the
// carrier or to the run itself (a keeper on the line, say) has to be beaten.
function assessDribble(state: MatchState, carrier: MatchPlayer): Action & { kind: "dribble" } {
  let dir = normalize(sub(attackingGoal(carrier.side), carrier.pos));
  const runEnd = add(carrier.pos, scale(dir, CARRY_DISTANCE));
  let defender: MatchPlayer | null = null;
  let closestGap = DRIBBLE_CONTEST_RANGE;
  for (const o of opponents(state, carrier)) {
    const gap = distToSegment(o.pos, carrier.pos, runEnd);
    if (gap < closestGap) {
      defender = o;
      closestGap = gap;
    }
  }

  if (defender) {
    const away = sub(carrier.pos, defender.pos);
    const perp = { x: -dir.y, y: dir.x };
    const veer = dot(perp, away) >= 0 ? 0.8 : -0.8;
    dir = normalize(add(dir, scale(perp, veer)));
  }
  const beat = defender
    ? clamp(DRIBBLE_BASE + DRIBBLE_SKILL * (carrier.attributes.dribbling - challengeSkill(defender)), 0.15, 0.9)
    : DRIBBLE_FREE;
  const step = defender ? DRIBBLE_DISTANCE : CARRY_DISTANCE;
  return { kind: "dribble", to: clampToPitch(add(carrier.pos, scale(dir, step))), beat, defender };
}

// A clearance lands as a 50/50 somewhere upfield
export function clearanceTarget(carrier: MatchPlayer, distance: number): Vec {
  const dir = normalize(sub(attackingGoal(carrier.side), carrier.pos));
  return clampToPitch(add(carrier.pos, scale(dir, distance)));
}

// Every option the ball carrier has, scored in expected-goal units:
// value if it works minus what it costs if it doesn't. Attacking teams
// weigh the upside more and the downside less, so they take more risks.
export function scoreOptions(state: MatchState, carrier: MatchPlayer): Option[] {
  const side = carrier.side;
  const isKeeper = carrier.position === "GK";
  const options: Option[] = [];
  const mentality = state.teams[side].tactics.mentality;
  const gain = 1 + MENTALITY_RISK * mentality;
  const loss = 1 - MENTALITY_RISK * mentality;
  const weigh = (chance: number, value: number, cost: number) => chance * value * gain - (1 - chance) * cost * loss;

  const maxPass = isKeeper ? KEEPER_PASS_MAX_DISTANCE : PASS_MAX_DISTANCE;
  for (const mate of teammates(state, carrier)) {
    const d = dist(carrier.pos, mate.pos);
    if (d < 2) continue;
    if (d <= maxPass) {
      const { success, risks } = assessPass(state, carrier, mate.pos);
      const midpoint = scale(add(carrier.pos, mate.pos), 0.5);
      options.push({
        action: { kind: "pass", receiver: mate, success, risks },
        utility: weigh(success, possessionValue(side, mate.pos), turnoverCost(side, midpoint)),
      });
    }

    // Into space ahead of anyone further upfield than the ball
    if (isKeeper || toTeamFrame(side, mate.pos).x <= toTeamFrame(side, carrier.pos).x) continue;
    const ahead = normalize(sub(attackingGoal(side), mate.pos));
    for (const lead of THROUGH_BALL_LEADS) {
      const target = clampToPitch(add(mate.pos, scale(ahead, lead)));
      if (dist(carrier.pos, target) > THROUGH_BALL_MAX_DISTANCE) continue;
      const lane = assessPass(state, carrier, target);
      const arrives = lane.success * raceWinChance(state, mate, target);
      options.push({
        action: { kind: "through", receiver: mate, target, success: lane.success, risks: lane.risks },
        utility: weigh(arrives, possessionValue(side, target), turnoverCost(side, target)),
      });
    }
  }

  const clearDistance = isKeeper ? KEEPER_KICK_DISTANCE : CLEAR_DISTANCE;
  const landing = clearanceTarget(carrier, clearDistance);
  const win = looseBallWinChance(state, carrier, landing);
  options.push({
    action: { kind: "clear", distance: clearDistance },
    utility: weigh(win, LOOSE_BALL_DISCOUNT * possessionValue(side, landing), turnoverCost(side, landing)),
  });

  if (!isKeeper) {
    const xg = shotXg(state, carrier);
    options.push({ action: { kind: "shoot", xg }, utility: weigh(xg, 1, POSSESSION_VALUE) });

    const dribble = assessDribble(state, carrier);
    options.push({
      action: dribble,
      utility: weigh(dribble.beat, possessionValue(side, dribble.to), turnoverCost(side, carrier.pos)),
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

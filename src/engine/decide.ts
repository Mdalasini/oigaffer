import {
  CLEAR_DISTANCE,
  CLEAR_MAX_DEPTH,
  CLEAR_OUTWARD,
  CROSS_ZONE_WIDTH,
  CROSS_ZONE_X,
  FREE_KICK_SHOT_RANGE,
  OFFSIDE_PERCEPTION,
  THROW_MAX_DISTANCE,
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
  MENTALITY_DIRECT,
  MENTALITY_RISK,
  PASS_MAX_DISTANCE,
  THROUGH_BALL_DEPTH,
  THROUGH_BALL_LEADS,
  THROUGH_BALL_MAX_DISTANCE,
  POSSESSION_VALUE,
} from "./constants";
import { add, CENTRE, clampToPitch, dist, distToSegment, dot, normalize, scale, sub, type Vec } from "./geometry";
import { offsideBy } from "./referee";
import { inBox } from "./restarts";
import {
  attackingGoal,
  challengeSkill,
  fromTeamFrame,
  nearest,
  opponents,
  teammates,
  toTeamFrame,
  type MatchPlayer,
  type MatchState,
  type ShotKind,
} from "./state";
import {
  assessCross,
  assessPass,
  freeKickXg,
  penaltyXg,
  looseBallWinChance,
  possessionValue,
  raceWinChance,
  shotXg,
  turnoverCost,
  type CrossAssessment,
  type InterceptRisk,
} from "./valuation";

export type Action =
  | { kind: "pass"; receiver: MatchPlayer; success: number; risks: InterceptRisk[] }
  | { kind: "through"; receiver: MatchPlayer; target: Vec; success: number; risks: InterceptRisk[] }
  | { kind: "shoot"; xg: number; shot: ShotKind }
  | ({ kind: "cross"; target: MatchPlayer } & CrossAssessment)
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

// A clearance lands as a 50/50 somewhere upfield. From wide it's angled towards
// the touchline, where the worst case is a throw-in.
export function clearanceTarget(carrier: MatchPlayer, distance: number): Vec {
  let dir = normalize(sub(attackingGoal(carrier.side), carrier.pos));
  const wide = carrier.pos.y - CENTRE.y;
  if (Math.abs(wide) > CROSS_ZONE_WIDTH) dir = normalize(add(dir, { x: 0, y: Math.sign(wide) * CLEAR_OUTWARD }));
  const room = CLEAR_MAX_DEPTH - toTeamFrame(carrier.side, carrier.pos).x;
  const along = toTeamFrame(carrier.side, add(carrier.pos, dir)).x - toTeamFrame(carrier.side, carrier.pos).x;
  const length = along > 0 ? Math.max(5, Math.min(distance, room / along)) : distance;
  return add(carrier.pos, scale(dir, length));
}

// What a restart allows the taker to do. Open play allows everything.
const ALLOWED = {
  open: { pass: true, through: true, clear: true, shoot: true, dribble: true, cross: true },
  kickoff: { pass: true, through: false, clear: false, shoot: false, dribble: false, cross: false },
  throw_in: { pass: true, through: true, clear: false, shoot: false, dribble: false, cross: false },
  goal_kick: { pass: true, through: true, clear: true, shoot: false, dribble: false, cross: false },
  corner: { pass: false, through: false, clear: false, shoot: false, dribble: false, cross: true },
  free_kick: { pass: true, through: true, clear: true, shoot: true, dribble: false, cross: true },
  indirect_free_kick: { pass: true, through: true, clear: true, shoot: false, dribble: false, cross: false },
  penalty: { pass: false, through: false, clear: false, shoot: true, dribble: false, cross: false },
} as const;

// Restarts that can't produce an offside
const NO_OFFSIDE = new Set(["throw_in", "goal_kick", "corner"]);

const inCrossingZone = (p: MatchPlayer) => {
  const t = toTeamFrame(p.side, p.pos);
  return t.x > CROSS_ZONE_X && Math.abs(t.y - CENTRE.y) > CROSS_ZONE_WIDTH;
};

// Every option the ball carrier has, scored in expected-goal units:
// value if it works minus what it costs if it doesn't. Attacking teams
// weigh the upside more and the downside less, so they take more risks.
export function scoreOptions(state: MatchState, carrier: MatchPlayer): Option[] {
  const side = carrier.side;
  const isKeeper = carrier.position === "GK";
  const setPiece = state.ball.setPiece;
  const allowed = ALLOWED[setPiece ?? "open"];
  const options: Option[] = [];
  const mentality = state.teams[side].tactics.mentality;
  const gain = 1 + MENTALITY_RISK * mentality;
  const loss = 1 - MENTALITY_RISK * mentality;
  const weigh = (chance: number, value: number, cost: number) => chance * value * gain - (1 - chance) * cost * loss;

  if (setPiece === "penalty") {
    return [{ action: { kind: "shoot", xg: penaltyXg(state, carrier), shot: "penalty" }, utility: 1 }];
  }

  const maxPass = setPiece === "throw_in" ? THROW_MAX_DISTANCE : isKeeper ? KEEPER_PASS_MAX_DISTANCE : PASS_MAX_DISTANCE;
  // Passers don't play it to someone obviously offside; a run that's only just off fools them
  const looksOffside = (mate: MatchPlayer) =>
    !NO_OFFSIDE.has(setPiece ?? "") && offsideBy(state, mate) > OFFSIDE_PERCEPTION;

  for (const mate of teammates(state, carrier)) {
    if (looksOffside(mate)) continue;
    const d = dist(carrier.pos, mate.pos);
    if (d < 2) continue;
    if (allowed.pass && d <= maxPass) {
      const { success, risks } = assessPass(state, carrier, mate.pos);
      const midpoint = scale(add(carrier.pos, mate.pos), 0.5);
      options.push({
        action: { kind: "pass", receiver: mate, success, risks },
        utility: weigh(success, possessionValue(side, mate.pos), turnoverCost(side, midpoint)),
      });
    }

    // Into space ahead of anyone further upfield than the ball
    if (!allowed.through || isKeeper || toTeamFrame(side, mate.pos).x <= toTeamFrame(side, carrier.pos).x) continue;
    const ahead = normalize(sub(attackingGoal(side), mate.pos));
    for (const lead of THROUGH_BALL_LEADS) {
      const spot = toTeamFrame(side, clampToPitch(add(mate.pos, scale(ahead, lead))));
      const target = fromTeamFrame(side, { x: Math.min(spot.x, THROUGH_BALL_DEPTH), y: spot.y });
      const reach = setPiece === "throw_in" ? THROW_MAX_DISTANCE : THROUGH_BALL_MAX_DISTANCE;
      if (dist(carrier.pos, target) > reach) continue;
      const lane = assessPass(state, carrier, target);
      const arrives = lane.success * raceWinChance(state, mate, target);
      options.push({
        action: { kind: "through", receiver: mate, target, success: lane.success, risks: lane.risks },
        utility: weigh(arrives, possessionValue(side, target), turnoverCost(side, target)),
      });
    }
  }

  // Balls into the box: from wide in open play, from corners, and from free kicks in range
  const crossFrom = setPiece === "corner" || (allowed.cross && !isKeeper && inCrossingZone(carrier));
  if (crossFrom) {
    for (const target of teammates(state, carrier)) {
      if (target.position === "GK" || !inBox(side, target.pos) || looksOffside(target)) continue;
      const cross = assessCross(state, carrier, target);
      const chance = cross.delivery * (1 - cross.claim) * cross.duel;
      // A failed cross is usually only half lost: cleared to the edge of the box, or out for a corner
      options.push({
        action: { kind: "cross", target, ...cross },
        utility: weigh(chance, cross.xg + possessionValue(side, target.pos), LOOSE_BALL_DISCOUNT * turnoverCost(side, target.pos)),
      });
    }
  }
  // A corner with nobody in the box gets played short
  if (setPiece === "corner" && options.length === 0) {
    return scoreOptions({ ...state, ball: { ...state.ball, setPiece: "throw_in" } }, carrier);
  }

  if (allowed.clear) {
    const direct = LOOSE_BALL_DISCOUNT * (1 - MENTALITY_DIRECT * mentality);
    const clearDistance = isKeeper ? KEEPER_KICK_DISTANCE : CLEAR_DISTANCE;
    const landing = clampToPitch(clearanceTarget(carrier, clearDistance));
    const win = looseBallWinChance(state, carrier, landing);
    options.push({
      action: { kind: "clear", distance: clearDistance },
      utility: weigh(win, direct * possessionValue(side, landing), turnoverCost(side, landing)),
    });
  }

  if (!isKeeper && allowed.shoot) {
    if (setPiece === "free_kick") {
      if (dist(carrier.pos, attackingGoal(side)) < FREE_KICK_SHOT_RANGE) {
        const xg = freeKickXg(carrier);
        options.push({ action: { kind: "shoot", xg, shot: "free_kick" }, utility: weigh(xg, 1, POSSESSION_VALUE) });
      }
    } else {
      const xg = shotXg(state, carrier);
      options.push({ action: { kind: "shoot", xg, shot: "open_play" }, utility: weigh(xg, 1, POSSESSION_VALUE) });
    }
  }

  if (!isKeeper && allowed.dribble) {
    const dribble = assessDribble(state, carrier);
    options.push({
      action: dribble,
      utility: weigh(dribble.beat, possessionValue(side, dribble.to), turnoverCost(side, carrier.pos)),
    });
  }
  // A throw with nobody in range goes to whoever is nearest; anything else is knocked forward
  if (options.length === 0 && setPiece === "throw_in") {
    const mate = nearest(teammates(state, carrier), carrier.pos);
    if (mate) {
      const { success, risks } = assessPass(state, carrier, mate.pos);
      options.push({ action: { kind: "pass", receiver: mate, success, risks }, utility: 0 });
    }
  }
  if (options.length === 0) {
    options.push({ action: { kind: "clear", distance: isKeeper ? KEEPER_KICK_DISTANCE : CLEAR_DISTANCE }, utility: 0 });
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

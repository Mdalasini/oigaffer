import { MAX_DRIBBLE_TOUCH_SPEED, PITCH_LENGTH, PITCH_WIDTH, TACKLE_REACH, TOP_SPEED, TOUCH_INTERVAL } from "./constants";
import { bestShot, chanceRunningIn, onTheGrid, shotOptions, whereToStand } from "./chance";
import { distanceRunIn, tackleWinChance, timeToRun, type Defender } from "./defender";
import { directionTo } from "./direction";
import { GOAL_CENTRE } from "./goal";
import type { Keeper } from "./keeper";
import { INTERCEPTOR, interceptionOf, leadPass, passFlight } from "./passing";
import type { Point } from "./shooting";

export type Opponent = { at: Defender; moving: [vx: number, vy: number]; tackling: number; recoversIn: number };

export const speedTowards = ([vx, vy]: [number, number], from: [number, number], to: Point) => {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return distance > 0 ? (vx * (to[0] - from[0]) + vy * (to[1] - from[1])) / distance : 0;
};

export function canGetThere({ at, moving, recoversIn }: Opponent, spot: Point, timeThere: number): boolean {
  const toReach = Math.max(0, Math.hypot(spot[0] - at[0], spot[1] - at[1]) - TACKLE_REACH);
  return recoversIn + timeToRun(toReach, TOP_SPEED, recoversIn > 0 ? 0 : speedTowards(moving, at, spot)) <= timeThere;
}

export const chanceOfBeating = (defenders: Opponent[], runner: Runner) =>
  defenders.reduce((chance, { tackling }) => chance * (1 - tackleWinChance(tackling, runner.dribbling)), 1);

export type Runner = { shooting: number; dribbling: number; speed: number };

export type Support = Runner & { across: number };

export function closingIn(defender: Opponent, spot: Point, time: number): Opponent {
  const { at, moving, recoversIn } = defender;
  const { distance, onwardX, onwardY } = directionTo([...at, 0], spot[0], spot[1]);
  const running = Math.max(0, time - recoversIn);
  const covered = Math.min(Math.max(0, distance - TACKLE_REACH), distanceRunIn(running, TOP_SPEED, recoversIn > 0 ? 0 : speedTowards(moving, at, spot)));
  return { ...defender, at: [at[0] + onwardX * covered, at[1] + onwardY * covered], moving: [0, 0], recoversIn: 0 };
}

export function passingAt(spot: Point, time: number, support: Support, defenders: Opponent[], keeper: Keeper | null, dt: number): number {
  const teammate: [number, number] = [spot[0], Math.max(0, Math.min(PITCH_WIDTH, spot[1] + support.across))];
  const defendersThen = defenders.map((defender) => closingIn(defender, spot, time));
  return passValue(spot, { ...support, at: teammate, moving: [0, 0] }, keeper, defendersThen, dt);
}

export function bestChanceFurtherOn(from: Point, runner: Runner, keeper: Keeper | null, defenders: Opponent[], dt: number, support: Support | null): number {
  const { distance, onwardX, onwardY } = directionTo(from, PITCH_LENGTH, GOAL_CENTRE);
  const touch = MAX_DRIBBLE_TOUCH_SPEED * TOUCH_INTERVAL;
  const inTheWay = new Set<Opponent>();
  let lastFree: { spot: Point; time: number } | null = null;
  let best = 0;
  for (let carried = touch; carried < distance; carried += touch) {
    const next: Point = [from[0] + onwardX * carried, from[1] + onwardY * carried, 0];
    const timeThere = timeToRun(carried, MAX_DRIBBLE_TOUCH_SPEED, runner.speed);
    const wasFree = inTheWay.size === 0;
    for (const defender of defenders) if (canGetThere(defender, next, timeThere)) inTheWay.add(defender);
    if (wasFree && inTheWay.size > 0 && support && lastFree) {
      best = Math.max(best, passingAt(lastFree.spot, lastFree.time, support, defenders, keeper, dt));
    }
    if (inTheWay.size === 0) lastFree = { spot: next, time: timeThere };
    const gettingThere = chanceOfBeating([...inTheWay], runner);
    if (gettingThere <= best) continue;
    best = Math.max(best, gettingThere * chanceRunningIn(next, runner.shooting, keeper !== null, dt));
  }
  return best;
}

export function whereTheyGetTo({ at, recoversIn, tackling }: Opponent, attempt: { point: Point; shortfall: number } | null): Opponent {
  if (!attempt) return { at, moving: [0, 0], recoversIn, tackling };
  const { distance, onwardX, onwardY } = directionTo([...at, 0], attempt.point[0], attempt.point[1]);
  const moved = Math.max(0, distance - INTERCEPTOR.reach - attempt.shortfall);
  return { at: [at[0] + onwardX * moved, at[1] + onwardY * moved], moving: [0, 0], recoversIn: 0, tackling };
}

export type Receiver = Runner & { at: [x: number, y: number]; moving: [vx: number, vy: number] };

export function passValue(from: Point, receiver: Receiver, keeper: Keeper | null, defenders: Opponent[], dt: number): number {
  const pass = leadPass(from, receiver.at, receiver.moving);
  const flight = pass && passFlight(from, pass, dt);
  if (!pass || !flight) return 0;
  const attempts = defenders.map(({ at, recoversIn }) => interceptionOf(flight, at, dt, recoversIn));
  if (attempts.some((attempt) => attempt && attempt.shortfall <= 0)) return 0;
  const defendersThen = defenders.map((defender, i) => whereTheyGetTo(defender, attempts[i]!));
  const receivedAt = onTheGrid(pass.to);
  const options = shotOptions(receivedAt, receiver.shooting, dt);
  const setKeeper = keeper && (whereToStand(receivedAt, options, keeper, dt) ?? keeper);
  const shootingFirstTime = bestShot(options, setKeeper, dt, defendersThen.map(({ at }) => at)).chance;
  return Math.max(shootingFirstTime, bestChanceFurtherOn(pass.to, { ...receiver, speed: 0 }, keeper, defendersThen, dt, null));
}

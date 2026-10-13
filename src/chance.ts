import {
  BALL_RADIUS,
  CROSSBAR_HEIGHT,
  GOAL_WIDTH,
  KEEPER_REACH,
  PITCH_LENGTH,
  TIME_STEP,
} from "./constants";
import { straightFlight, type StraightFlight } from "./flight";
import { GOAL_CENTRE, isGoal } from "./goal";
import { bestInterception, firstDivingStep, type Keeper } from "./keeper";
import { acrossTheShot, kick, spreadRadius, strikeSpeed, type Point } from "./shooting";

const AIMS_ACROSS = 9;
const AIM_HEIGHTS = [0.15, 0.5, 0.85].map((share) => share * CROSSBAR_HEIGHT);
const MISSES_PER_AIM = 16;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));


export type ShotOption = { aim: Point; misses: Point[]; scoring: StraightFlight[] };

export function goalAims(): Point[] {
  const widest = GOAL_WIDTH / 2 - BALL_RADIUS;
  return AIM_HEIGHTS.flatMap((z) =>
    Array.from({ length: AIMS_ACROSS }, (_, i): Point => [PITCH_LENGTH, GOAL_CENTRE - widest + (2 * widest * i) / (AIMS_ACROSS - 1), z]),
  );
}

export function missesInCircle(from: Point, aim: Point, radius: number): Point[] {
  const [acrossX, acrossY] = acrossTheShot(from, aim);
  return Array.from({ length: MISSES_PER_AIM }, (_, i) => {
    const offset = radius * Math.sqrt((i + 0.5) / MISSES_PER_AIM);
    const across = offset * Math.cos(i * GOLDEN_ANGLE);
    const up = offset * Math.sin(i * GOLDEN_ANGLE);
    return [aim[0] + acrossX * across, aim[1] + acrossY * across, aim[2] + up];
  });
}

function flightToGoal(from: Point, velocity: Point, dt: number): StraightFlight | null {
  const flight = straightFlight(from, velocity, dt);
  const goalAt = flight?.crossesGoalLineAt;
  return goalAt && isGoal(goalAt[1], goalAt[2]) ? flight : null;
}

let lastWorkedOut: { from: Point; grade: number; dt: number; options: ShotOption[] } | null = null;

const isSameShot = (a: { from: Point; grade: number; dt: number }, from: Point, grade: number, dt: number) =>
  a.from.every((value, i) => value === from[i]) && a.grade === grade && a.dt === dt;

export function shotOptions(from: Point, grade: number, dt = TIME_STEP): ShotOption[] {
  if (lastWorkedOut && isSameShot(lastWorkedOut, from, grade, dt)) return lastWorkedOut.options;
  const strike = strikeSpeed(grade);
  const options = goalAims()
    .map((aim) => {
      const misses = missesInCircle(from, aim, spreadRadius(grade, from, aim));
      const scoring = misses.map((miss) => flightToGoal(from, kick(from, miss, strike), dt)).filter((flight) => flight !== null);
      return { aim, misses, scoring };
    })
    .sort((a, b) => b.scoring.length - a.scoring.length);
  lastWorkedOut = { from: [...from], grade, dt, options };
  return options;
}

function keeperReaches(flight: StraightFlight, keeper: Keeper, dt: number): boolean {
  const divingFrom = firstDivingStep(dt);
  const interception = bestInterception(keeper, flight, (step) => step + 1 - divingFrom, dt);
  return interception !== null && interception.shortfall <= 0;
}

export function chanceAgainst(option: ShotOption, keeper: Keeper | null, dt = TIME_STEP): number {
  const beaten = keeper ? option.scoring.filter((flight) => !keeperReaches(flight, keeper, dt)) : option.scoring;
  return beaten.length / option.misses.length;
}

export type { Keeper };

export function bestShot(options: ShotOption[], keeper: Keeper | null, dt = TIME_STEP): { aim: Point; chance: number } {
  let best = { aim: options[0]!.aim, chance: -1 };
  for (const option of options) {
    if (option.scoring.length / option.misses.length <= best.chance) break;
    const chance = chanceAgainst(option, keeper, dt);
    if (chance > best.chance) best = { aim: option.aim, chance };
  }
  return best;
}

const KEEPER_SPOTS_CONSIDERED = 16;

function towardsTheGoal(from: Point): [x: number, y: number] | null {
  const halfWidth = GOAL_WIDTH / 2;
  const toNear = Math.atan2(GOAL_CENTRE - halfWidth - from[1], PITCH_LENGTH - from[0]);
  const toFar = Math.atan2(GOAL_CENTRE + halfWidth - from[1], PITCH_LENGTH - from[0]);
  const bisector = (toNear + toFar) / 2;
  return Math.cos(bisector) > 0 ? [Math.cos(bisector), Math.sin(bisector)] : null;
}

type Spot = { out: number; spot: Keeper; chance: number; risk: number };

const isSaferThan = (a: Spot, b: Spot) =>
  a.risk !== b.risk ? a.risk < b.risk : a.chance !== b.chance ? a.chance < b.chance : a.out > b.out;

export function whereToStand(from: Point, options: ShotOption[], keeper: Keeper, dt = TIME_STEP): Keeper | null {
  const direction = towardsTheGoal(from);
  if (!direction || from[0] >= PITCH_LENGTH) return null;
  const toGoalLine = (PITCH_LENGTH - from[0]) / direction[0];
  const closest = Math.min(KEEPER_REACH, toGoalLine);
  const keeperOut = Math.max(closest, Math.min(toGoalLine, (keeper[0] - from[0]) * direction[0] + (keeper[1] - from[1]) * direction[1]));
  const spotAt = (out: number): Spot => {
    const spot: Keeper = [from[0] + direction[0] * out, from[1] + direction[1] * out];
    const { chance } = bestShot(options, spot, dt);
    return { out, spot, chance, risk: chance };
  };
  const here = spotAt(keeperOut);
  const spots = Array.from({ length: KEEPER_SPOTS_CONSIDERED }, (_, i) => spotAt(toGoalLine - ((toGoalLine - closest) * i) / (KEEPER_SPOTS_CONSIDERED - 1)));
  const deeper = spots.filter((spot) => spot.out > keeperOut).sort((a, b) => a.out - b.out);
  const nearerTheBall = spots.filter((spot) => spot.out <= keeperOut).sort((a, b) => b.out - a.out);
  let best = here;
  for (const way of [deeper, nearerTheBall]) {
    let worstOnTheWay = here.chance;
    for (const spot of way) {
      worstOnTheWay = Math.max(worstOnTheWay, spot.chance);
      spot.risk = worstOnTheWay;
      if (isSaferThan(spot, best)) best = spot;
    }
  }
  return best.spot;
}

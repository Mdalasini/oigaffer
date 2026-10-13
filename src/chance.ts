import {
  BALL_RADIUS,
  CROSSBAR_HEIGHT,
  GOAL_WIDTH,
  PITCH_LENGTH,
  TIME_STEP,
} from "./constants";
import { ballFlight, crossing, GOAL_LINE, hasCrossed } from "./flight";
import { GOAL_CENTRE, isGoal } from "./goal";
import { bestInterception, firstDivingStep, type Keeper } from "./keeper";
import { acrossTheShot, kick, spreadRadius, strikeSpeed, type Point } from "./shooting";

const AIMS_ACROSS = 9;
const AIM_HEIGHTS = [0.15, 0.5, 0.85].map((share) => share * CROSSBAR_HEIGHT);
const MISSES_PER_AIM = 16;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

type Flight = { steps: [position: Point, velocity: Point][] };
export type ShotOption = { aim: Point; misses: Point[]; scoring: Flight[] };

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

function flightToGoal(from: Point, velocity: Point, dt: number): Flight | null {
  const steps: Flight["steps"] = [];
  for (const [now, moving] of ballFlight(from, velocity, dt)) {
    steps.push([now, moving]);
    if (!hasCrossed(GOAL_LINE, now)) continue;
    const [, y, z] = crossing(GOAL_LINE, now, moving);
    return isGoal(y, z) ? { steps } : null;
  }
  return null;
}

export function shotOptions(from: Point, grade: number, dt = TIME_STEP): ShotOption[] {
  const strike = strikeSpeed(grade);
  return goalAims().map((aim) => {
    const misses = missesInCircle(from, aim, spreadRadius(grade, from, aim));
    const scoring = misses.map((miss) => flightToGoal(from, kick(from, miss, strike), dt)).filter((flight) => flight !== null);
    return { aim, misses, scoring };
  });
}

function keeperReaches({ steps }: Flight, keeper: Keeper, dt: number): boolean {
  const divingFrom = firstDivingStep(dt);
  const interception = bestInterception(keeper, steps, (step) => step + 1 - divingFrom, dt);
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
    const chance = chanceAgainst(option, keeper, dt);
    if (chance > best.chance) best = { aim: option.aim, chance };
  }
  return best;
}

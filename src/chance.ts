import {
  BALL_RADIUS,
  CROSSBAR_HEIGHT,
  GOAL_WIDTH,
  KEEPER_REACH,
  PITCH_LENGTH,
  TIME_STEP,
} from "./constants";
import { blocks, type Defender } from "./defender";
import { straightFlight, type StraightFlight } from "./flight";
import { GOAL_CENTRE, isGoal } from "./goal";
import { bestInterception, firstMovingStep } from "./interception";
import { KEEPER, type Keeper } from "./keeper";
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

const REMEMBERED_SHOTS = 4;
const recentlyWorkedOut: { from: Point; grade: number; dt: number; options: ShotOption[] }[] = [];

const isSameShot = (a: { from: Point; grade: number; dt: number }, from: Point, grade: number, dt: number) =>
  a.from.every((value, i) => value === from[i]) && a.grade === grade && a.dt === dt;

export function shotOptions(from: Point, grade: number, dt = TIME_STEP): ShotOption[] {
  const remembered = recentlyWorkedOut.find((shot) => isSameShot(shot, from, grade, dt));
  if (remembered) return remembered.options;
  const strike = strikeSpeed(grade);
  const options = goalAims()
    .map((aim) => {
      const misses = missesInCircle(from, aim, spreadRadius(grade, from, aim));
      const scoring = misses.map((miss) => flightToGoal(from, kick(from, miss, strike), dt)).filter((flight) => flight !== null);
      return { aim, misses, scoring };
    })
    .sort((a, b) => b.scoring.length - a.scoring.length);
  recentlyWorkedOut.unshift({ from: [...from], grade, dt, options });
  recentlyWorkedOut.length = Math.min(recentlyWorkedOut.length, REMEMBERED_SHOTS);
  return options;
}

function keeperReaches(flight: StraightFlight, keeper: Keeper, dt: number): boolean {
  const divingFrom = firstMovingStep(KEEPER, dt);
  const interception = bestInterception(KEEPER, keeper, flight, (step) => step + 1 - divingFrom, dt);
  return interception !== null && interception.shortfall <= 0;
}

const getsThrough = (flight: StraightFlight, keeper: Keeper | null, defenders: Defender[], dt: number) =>
  !defenders.some((defender) => blocks(defender, flight)) && !(keeper && keeperReaches(flight, keeper, dt));

export function chanceAgainst(option: ShotOption, keeper: Keeper | null, dt = TIME_STEP, defenders: Defender[] = []): number {
  return option.scoring.filter((flight) => getsThrough(flight, keeper, defenders, dt)).length / option.misses.length;
}

export type { Keeper };

export function bestShot(
  options: ShotOption[],
  keeper: Keeper | null,
  dt = TIME_STEP,
  defenders: Defender[] = [],
): { aim: Point; chance: number } {
  let best = { aim: options[0]!.aim, chance: -1 };
  for (const option of options) {
    if (option.scoring.length / option.misses.length <= best.chance) break;
    const chance = chanceAgainst(option, keeper, dt, defenders);
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

type LineToGoal = { from: Point; direction: [x: number, y: number]; toGoalLine: number; closest: number };
type Spot = { out: number; chance: number; risk: number };
type SpotChances = { line: LineToGoal; options: ShotOption[]; chances: number[] };

function lineToGoal(from: Point): LineToGoal | null {
  const direction = towardsTheGoal(from);
  if (!direction || from[0] >= PITCH_LENGTH) return null;
  const toGoalLine = (PITCH_LENGTH - from[0]) / direction[0];
  return { from, direction, toGoalLine, closest: Math.min(KEEPER_REACH, toGoalLine) };
}

const spotAt = ({ from, direction }: LineToGoal, out: number): Keeper => [from[0] + direction[0] * out, from[1] + direction[1] * out];

const consideredOut = ({ toGoalLine, closest }: LineToGoal, i: number) => toGoalLine - ((toGoalLine - closest) * i) / (KEEPER_SPOTS_CONSIDERED - 1);

function spotChances(line: LineToGoal, options: ShotOption[], dt: number): SpotChances {
  const chances = Array.from({ length: KEEPER_SPOTS_CONSIDERED }, (_, i) => bestShot(options, spotAt(line, consideredOut(line, i)), dt).chance);
  return { line, options, chances };
}

const isSaferThan = (a: Spot, b: Spot) =>
  a.risk !== b.risk ? a.risk < b.risk : a.chance !== b.chance ? a.chance < b.chance : a.out > b.out;

function safestSpotOn(line: LineToGoal, { options, chances }: SpotChances, keeper: Keeper, dt: number): Keeper {
  const { from, direction, toGoalLine, closest } = line;
  const keeperOut = Math.max(closest, Math.min(toGoalLine, (keeper[0] - from[0]) * direction[0] + (keeper[1] - from[1]) * direction[1]));
  const hereChance = bestShot(options, spotAt(line, keeperOut), dt).chance;
  const here: Spot = { out: keeperOut, chance: hereChance, risk: hereChance };
  const spots = chances.map((chance, i): Spot => ({ out: consideredOut(line, i), chance, risk: chance }));
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
  return spotAt(line, best.out);
}

export function whereToStand(from: Point, options: ShotOption[], keeper: Keeper, dt = TIME_STEP): Keeper | null {
  const line = lineToGoal(from);
  return line && safestSpotOn(line, spotChances(line, options, dt), keeper, dt);
}

const REMEMBERED_SPOT_CHANCES = 16;
const spotChancesWorkedOut = new Map<string, SpotChances | null>();

function spotChancesNear(near: Point, grade: number, dt: number): SpotChances | null {
  const key = `${near.join()}|${grade}|${dt}`;
  const remembered = spotChancesWorkedOut.get(key);
  if (remembered !== undefined) {
    spotChancesWorkedOut.delete(key);
    spotChancesWorkedOut.set(key, remembered);
    return remembered;
  }
  const line = lineToGoal(near);
  const workedOut = line && spotChances(line, shotOptions(near, grade, dt), dt);
  if (spotChancesWorkedOut.size >= REMEMBERED_SPOT_CHANCES) spotChancesWorkedOut.delete(spotChancesWorkedOut.keys().next().value!);
  spotChancesWorkedOut.set(key, workedOut);
  return workedOut;
}

export function whereToStandAgainst(ball: Point, grade: number, keeper: Keeper, dt = TIME_STEP): Keeper | null {
  const line = lineToGoal(ball);
  if (!line) return null;
  const nearby = spotChancesNear(onTheGrid(ball), grade, dt);
  return nearby ? safestSpotOn(line, nearby, keeper, dt) : whereToStand(ball, shotOptions(ball, grade, dt), keeper, dt);
}

const SPOT_GRID = 0.5;
const REMEMBERED_CHANCES = 4096;
const chancesOnceKeeperIsSet = new Map<string, number>();

const toGrid = (value: number) => Math.round(value / SPOT_GRID) * SPOT_GRID;

export const onTheGrid = ([x, y, z]: Point): Point => [toGrid(x), toGrid(y), z];

const KEEPER_ON_THE_LINE: Keeper = [PITCH_LENGTH, GOAL_CENTRE];

export function chanceOnceKeeperIsSet(spot: Point, grade: number, withKeeper: boolean, dt = TIME_STEP): number {
  const near = onTheGrid(spot);
  const key = `${near.join()}|${withKeeper}|${grade}|${dt}`;
  const remembered = chancesOnceKeeperIsSet.get(key);
  if (remembered !== undefined) return remembered;
  const workedOut = withKeeper ? spotChancesNear(near, grade, dt) : null;
  const options = workedOut?.options ?? shotOptions(near, grade, dt);
  const setKeeper = withKeeper ? (workedOut ? safestSpotOn(workedOut.line, workedOut, KEEPER_ON_THE_LINE, dt) : KEEPER_ON_THE_LINE) : null;
  const chance = bestShot(options, setKeeper, dt).chance;
  if (chancesOnceKeeperIsSet.size >= REMEMBERED_CHANCES) chancesOnceKeeperIsSet.delete(chancesOnceKeeperIsSet.keys().next().value!);
  chancesOnceKeeperIsSet.set(key, chance);
  return chance;
}

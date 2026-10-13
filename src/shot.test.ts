import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import {
  AVERAGE_SHOOTING_GRADE,
  BEST_SHOOTING_GRADE,
  CROSSBAR_HEIGHT,
  GOAL_WIDTH,
  GRAVITY,
  MAX_RELEASE_ANGLE,
  PITCH_LENGTH,
  PITCH_WIDTH,
  TIME_STEP,
  STRONGEST_STRIKE_SPEED,
  TOUCH_REACH,
  WORST_SHOOTING_GRADE,
} from "./constants";
import { kick, neededStrikeSpeed, releaseAngle, spreadAngle, spreadRadius, strikeSpeed, type Point } from "./shooting";
import { isGoal } from "./goal";
import { step } from "./systems";
import { addBall, addPlayer, createGame, setShot } from "./world";

const GOAL_CENTRE = PITCH_WIDTH / 2;
const SPOT: Point = [85, GOAL_CENTRE, 0];

function shootAt(aim: [y: number, z: number], grade: number, seed = 1) {
  const world = createGame(seed);
  const { GoalLineCrossing } = world.components;
  const p = addPlayer(world, SPOT[0] - 0.3, SPOT[1], 0, grade);
  const b = addBall(world, SPOT[0], SPOT[1]);
  setShot(world, p, PITCH_LENGTH, aim[0], aim[1]);
  for (let time = 0; !hasComponent(world, b, GoalLineCrossing) && time < 10; time += TIME_STEP) step(world);
  return { y: GoalLineCrossing.y[b]!, z: GoalLineCrossing.z[b]! };
}

function missesOver(shots: number, aim: [y: number, z: number], grade: number) {
  return Array.from({ length: shots }, (_, seed) => {
    const { y, z } = shootAt(aim, grade, seed + 1);
    return Math.hypot(y - aim[0], z - aim[1]);
  });
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function flyFrom(from: Point, velocity: Point) {
  const world = createGame();
  const { Position, Velocity, GoalLineCrossing } = world.components;
  const b = addBall(world, from[0], from[1]);
  [Velocity.x[b], Velocity.y[b], Velocity.z[b]] = velocity;
  let firstLanding = NaN;
  for (let time = 0; !hasComponent(world, b, GoalLineCrossing) && time < 10; time += TIME_STEP) {
    step(world);
    if (Number.isNaN(firstLanding) && Position.z[b] === 0) firstLanding = Position.x[b]!;
  }
  return { crossed: hasComponent(world, b, GoalLineCrossing), y: GoalLineCrossing.y[b]!, z: GoalLineCrossing.z[b]!, firstLanding };
}

describe("a ball in the air", () => {
  test("rises as high as gravity allows, then falls and bounces lower each time until it rolls", () => {
    const world = createGame();
    const { Position, Velocity } = world.components;
    const b = addBall(world, 50, 34);
    Velocity.z[b] = 10;
    const peaks: number[] = [];
    let highest = 0;
    for (let t = 0; t < 10; t += TIME_STEP) {
      step(world);
      highest = Math.max(highest, Position.z[b]!);
      if (Position.z[b] === 0 && highest > 0) {
        peaks.push(highest);
        highest = 0;
      }
    }
    expect(peaks[0]!).toBeCloseTo((10 * 10) / (2 * GRAVITY), 1);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]!).toBeLessThan(peaks[i - 1]!);
    expect(Position.z[b]).toBe(0);
    expect(Velocity.z[b]).toBe(0);
  });
});

describe("striking the ball", () => {
  const aim: Point = [PITCH_LENGTH, GOAL_CENTRE + 2, 1.5];

  test("struck as hard as the shooter can, the ball still reaches the spot they picked", () => {
    for (const grade of [WORST_SHOOTING_GRADE, AVERAGE_SHOOTING_GRADE, BEST_SHOOTING_GRADE]) {
      const flight = flyFrom(SPOT, kick(SPOT, aim, strikeSpeed(grade)));
      expect(flight.y).toBeCloseTo(aim[1], 1);
      expect(flight.z).toBeCloseTo(aim[2], 1);
    }
  });

  test("better shooters strike harder, so their shots fly flatter and faster", () => {
    const weak = kick(SPOT, aim, strikeSpeed(WORST_SHOOTING_GRADE));
    const strong = kick(SPOT, aim, strikeSpeed(BEST_SHOOTING_GRADE));
    expect(Math.hypot(...strong)).toBeGreaterThan(Math.hypot(...weak));
    expect(releaseAngle(SPOT, aim, strikeSpeed(BEST_SHOOTING_GRADE))).toBeLessThan(
      releaseAngle(SPOT, aim, strikeSpeed(WORST_SHOOTING_GRADE)),
    );
  });

  test("the steeper the release, the slower the ball leaves the boot", () => {
    for (const distance of [10, 25, 40]) {
      const to: Point = [SPOT[0] + distance, SPOT[1], 0];
      const angle = releaseAngle(SPOT, to, STRONGEST_STRIKE_SPEED);
      expect(Math.hypot(...kick(SPOT, to, STRONGEST_STRIKE_SPEED))).toBeCloseTo(STRONGEST_STRIKE_SPEED * Math.cos(angle), 6);
    }
  });

  test("the boot can't get far enough under a ball on the grass to lift it steeper than the steepest release", () => {
    const highAndClose: Point = [SPOT[0] + 3, SPOT[1], 8];
    const [vx, vy, vz] = kick(SPOT, highAndClose, STRONGEST_STRIKE_SPEED);
    expect(Math.atan2(vz, Math.hypot(vx, vy))).toBeLessThanOrEqual(MAX_RELEASE_ANGLE + 1e-9);
    expect(neededStrikeSpeed(SPOT, highAndClose)).toBe(Infinity);
    expect(MAX_RELEASE_ANGLE).toBeGreaterThan((40 * Math.PI) / 180);
    expect(MAX_RELEASE_ANGLE).toBeLessThan((50 * Math.PI) / 180);
  });

  test("the hardest striker's longest kick is a realistic 60 to 70 m", () => {
    const reaches = (distance: number) => neededStrikeSpeed([0, 0, 0], [distance, 0, 0]) <= STRONGEST_STRIKE_SPEED;
    expect(reaches(60)).toBe(true);
    expect(reaches(70)).toBe(false);
  });

  test("out of range, the shot drops short", () => {
    const tooFar: Point = [PITCH_LENGTH - 40, GOAL_CENTRE, 0];
    expect(neededStrikeSpeed(tooFar, aim)).toBeGreaterThan(strikeSpeed(WORST_SHOOTING_GRADE));
    const flight = flyFrom(tooFar, kick(tooFar, aim, strikeSpeed(WORST_SHOOTING_GRADE)));
    expect(flight.firstLanding).toBeLessThan(PITCH_LENGTH);
  });
});

describe("a player shooting at an empty goal", () => {
  const aim: [number, number] = [GOAL_CENTRE + 2, 1.2];

  test("every shot lands inside the shooter's circle around the spot they picked", () => {
    const radius = spreadRadius(WORST_SHOOTING_GRADE, SPOT, [PITCH_LENGTH, ...aim]);
    const misses = missesOver(50, aim, WORST_SHOOTING_GRADE);
    for (const miss of misses) expect(miss).toBeLessThanOrEqual(radius * 1.05);
    expect(Math.max(...misses)).toBeGreaterThan(radius * 0.5);
  });

  test("better shooters have a smaller circle", () => {
    const worst = average(missesOver(30, aim, WORST_SHOOTING_GRADE));
    const best = average(missesOver(30, aim, BEST_SHOOTING_GRADE));
    expect(best).toBeLessThan(worst / 3);
  });

  test("striking much harder than the shot needs makes the circle bigger", () => {
    const close: Point = [PITCH_LENGTH - 6, GOAL_CENTRE, 0];
    const target: Point = [PITCH_LENGTH, ...aim];
    const harderThanNeeded = strikeSpeed(AVERAGE_SHOOTING_GRADE) / neededStrikeSpeed(close, target);
    const unforced = spreadAngle(AVERAGE_SHOOTING_GRADE) * Math.hypot(6, 2, 1.2);
    expect(harderThanNeeded).toBeGreaterThan(2);
    expect(spreadRadius(AVERAGE_SHOOTING_GRADE, close, target)).toBeCloseTo(unforced * harderThanNeeded, 6);
  });

  test("runs onto a ball that isn't at their feet before striking it", () => {
    const world = createGame();
    const { Position, Velocity } = world.components;
    const p = addPlayer(world, 80, GOAL_CENTRE + 3);
    const b = addBall(world, 85, GOAL_CENTRE);
    setShot(world, p, PITCH_LENGTH, GOAL_CENTRE, 1);
    let gapWhenStruck = Infinity;
    while (Math.hypot(Velocity.x[b]!, Velocity.y[b]!) === 0) {
      gapWhenStruck = Math.hypot(Position.x[b]! - Position.x[p]!, Position.y[b]! - Position.y[p]!);
      step(world);
    }
    expect(gapWhenStruck).toBeLessThanOrEqual(TOUCH_REACH);
  });
});

describe("where the ball crosses the goal line", () => {
  test("between the posts and under the bar is a goal", () => {
    expect(isGoal(GOAL_CENTRE + GOAL_WIDTH / 2 - 0.1, CROSSBAR_HEIGHT - 0.1)).toBe(true);
  });

  test("above the bar or outside a post is not", () => {
    expect(isGoal(GOAL_CENTRE, CROSSBAR_HEIGHT + 0.1)).toBe(false);
    expect(isGoal(GOAL_CENTRE - GOAL_WIDTH / 2 - 0.1, 1)).toBe(false);
  });
});

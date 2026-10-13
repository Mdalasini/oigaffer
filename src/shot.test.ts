import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import {
  BEST_SHOOTING_GRADE,
  CROSSBAR_HEIGHT,
  GOAL_WIDTH,
  GRAVITY,
  MAX_SHOT_SPEED,
  PITCH_LENGTH,
  PITCH_WIDTH,
  TIME_STEP,
  TOUCH_REACH,
  WORST_SHOOTING_GRADE,
} from "./constants";
import { launchVelocity, neededShotSpeed, spreadRadius, type Point } from "./shooting";
import { isGoal, step } from "./systems";
import { addBall, addPlayer, createGame, setShot } from "./world";

const GOAL_CENTRE = PITCH_WIDTH / 2;
const SPOT: Point = [85, GOAL_CENTRE, 0];

function shootAt(aim: [y: number, z: number], speed: number, grade: number, seed = 1) {
  const world = createGame(seed);
  const { GoalLineCrossing } = world.components;
  const p = addPlayer(world, SPOT[0] - 0.3, SPOT[1], 0, grade);
  const b = addBall(world, SPOT[0], SPOT[1]);
  setShot(world, p, PITCH_LENGTH, aim[0], aim[1], speed);
  for (let time = 0; !hasComponent(world, b, GoalLineCrossing) && time < 10; time += TIME_STEP) step(world);
  return { y: GoalLineCrossing.y[b]!, z: GoalLineCrossing.z[b]! };
}

function missesOver(shots: number, aim: [y: number, z: number], speed: number, grade: number) {
  return Array.from({ length: shots }, (_, seed) => {
    const { y, z } = shootAt(aim, speed, grade, seed + 1);
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

describe("the power a shot needs", () => {
  const aim: Point = [PITCH_LENGTH, GOAL_CENTRE + 2, 1.5];

  test("struck perfectly with just that power, the ball reaches the spot", () => {
    const flight = flyFrom(SPOT, launchVelocity(SPOT, aim, neededShotSpeed(SPOT, aim)));
    expect(flight.y).toBeCloseTo(aim[1], 1);
    expect(flight.z).toBeCloseTo(aim[2], 1);
  });

  test("struck perfectly with more power, the ball still reaches the spot, on a flatter path", () => {
    const flight = flyFrom(SPOT, launchVelocity(SPOT, aim, 28));
    expect(flight.y).toBeCloseTo(aim[1], 1);
    expect(flight.z).toBeCloseTo(aim[2], 1);
  });

  test("with less, it drops short", () => {
    const flight = flyFrom(SPOT, launchVelocity(SPOT, aim, neededShotSpeed(SPOT, aim) - 2));
    expect(flight.firstLanding).toBeLessThan(PITCH_LENGTH);
  });

  test("from the far end of the pitch, more than anyone can strike a ball", () => {
    expect(neededShotSpeed([0, GOAL_CENTRE, 0], aim)).toBeGreaterThan(MAX_SHOT_SPEED);
  });
});

describe("a player shooting at an empty goal", () => {
  const aim: [number, number] = [GOAL_CENTRE + 2, 1.2];

  test("every shot lands inside the shooter's circle around the spot they picked", () => {
    const radius = spreadRadius(WORST_SHOOTING_GRADE, SPOT, [PITCH_LENGTH, ...aim], 20);
    const misses = missesOver(50, aim, 20, WORST_SHOOTING_GRADE);
    for (const miss of misses) expect(miss).toBeLessThanOrEqual(radius * 1.05);
    expect(Math.max(...misses)).toBeGreaterThan(radius * 0.5);
  });

  test("better shooters have a smaller circle", () => {
    const worst = average(missesOver(30, aim, 20, WORST_SHOOTING_GRADE));
    const best = average(missesOver(30, aim, 20, BEST_SHOOTING_GRADE));
    expect(best).toBeLessThan(worst / 4);
  });

  test("hitting it harder makes the circle bigger", () => {
    const soft = average(missesOver(30, aim, 15, WORST_SHOOTING_GRADE));
    const hard = average(missesOver(30, aim, 30, WORST_SHOOTING_GRADE));
    expect(hard).toBeGreaterThan(soft * 1.5);
  });

  test("no one can hit it harder than the most a ball can be struck", () => {
    const world = createGame();
    const { Velocity } = world.components;
    const p = addPlayer(world, SPOT[0] - 0.3, SPOT[1]);
    const b = addBall(world, SPOT[0], SPOT[1]);
    setShot(world, p, PITCH_LENGTH, ...aim, 60);
    while (Math.hypot(Velocity.x[b]!, Velocity.y[b]!) === 0) step(world);
    expect(Math.hypot(Velocity.x[b]!, Velocity.y[b]!, Velocity.z[b]!)).toBeCloseTo(MAX_SHOT_SPEED, 0);
  });

  test("runs onto a ball that isn't at their feet before striking it", () => {
    const world = createGame();
    const { Position, Velocity } = world.components;
    const p = addPlayer(world, 80, GOAL_CENTRE + 3);
    const b = addBall(world, 85, GOAL_CENTRE);
    setShot(world, p, PITCH_LENGTH, GOAL_CENTRE, 1, 25);
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

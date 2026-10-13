import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import { CROSSBAR_HEIGHT, GOAL_WIDTH, GRAVITY, PITCH_LENGTH, PITCH_WIDTH, TIME_STEP, TOUCH_REACH } from "./constants";
import { isGoal, step } from "./systems";
import { addBall, addPlayer, createGame, setShot, ShotType } from "./world";

const GOAL_CENTRE = PITCH_WIDTH / 2;

function shootAt(aim: [number, number], speed: number, type: ShotType, ball: [number, number] = [85, GOAL_CENTRE]) {
  const world = createGame();
  const { Position, Velocity, GoalLineCrossing } = world.components;
  const p = addPlayer(world, ball[0] - 0.3, ball[1]);
  const b = addBall(world, ...ball);
  setShot(world, p, PITCH_LENGTH, aim[0], aim[1], speed, type);
  let time = 0;
  let struckAt = NaN;
  let highest = 0;
  let firstLanding = NaN;
  while (!hasComponent(world, b, GoalLineCrossing) && time < 10) {
    step(world);
    time += TIME_STEP;
    if (Number.isNaN(struckAt) && Math.hypot(Velocity.x[b]!, Velocity.y[b]!) > 0) struckAt = time;
    highest = Math.max(highest, Position.z[b]!);
    if (Number.isNaN(firstLanding) && highest > 0 && Position.z[b] === 0) firstLanding = Position.x[b]!;
  }
  const crossed = hasComponent(world, b, GoalLineCrossing);
  return {
    crossed,
    y: GoalLineCrossing.y[b]!,
    z: GoalLineCrossing.z[b]!,
    flightTime: time - struckAt,
    highest,
    firstLanding,
  };
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

describe("a player shooting at an empty goal", () => {
  test("a driven shot goes where it is aimed", () => {
    const shot = shootAt([GOAL_CENTRE - 2, 1.5], 25, ShotType.Driven);
    expect(shot.y).toBeCloseTo(GOAL_CENTRE - 2, 1);
    expect(shot.z).toBeCloseTo(1.5, 1);
    expect(isGoal(shot.y, shot.z)).toBe(true);
  });

  test("a chip reaches the same spot on a higher, slower arc", () => {
    const driven = shootAt([GOAL_CENTRE + 2, 1.5], 25, ShotType.Driven);
    const chip = shootAt([GOAL_CENTRE + 2, 1.5], 25, ShotType.Chipped);
    expect(chip.y).toBeCloseTo(GOAL_CENTRE + 2, 1);
    expect(chip.z).toBeCloseTo(1.5, 1);
    expect(chip.highest).toBeGreaterThan(driven.highest + 5);
    expect(chip.flightTime).toBeGreaterThan(driven.flightTime * 2);
  });

  test("a ground shot rolls along the grass to where it is aimed", () => {
    const shot = shootAt([GOAL_CENTRE + 3, 2], 20, ShotType.Ground);
    expect(shot.highest).toBe(0);
    expect(shot.y).toBeCloseTo(GOAL_CENTRE + 3, 1);
    expect(isGoal(shot.y, shot.z)).toBe(true);
  });

  test("a harder shot gets there sooner", () => {
    const soft = shootAt([GOAL_CENTRE, 1], 15, ShotType.Driven);
    const hard = shootAt([GOAL_CENTRE, 1], 30, ShotType.Driven);
    expect(hard.flightTime).toBeLessThan(soft.flightTime * 0.6);
  });

  test("aimed above the bar it goes over; aimed outside the post it goes wide", () => {
    const over = shootAt([GOAL_CENTRE, CROSSBAR_HEIGHT + 0.5], 25, ShotType.Driven);
    const wide = shootAt([GOAL_CENTRE + GOAL_WIDTH / 2 + 0.5, 1], 25, ShotType.Driven);
    expect(isGoal(over.y, over.z)).toBe(false);
    expect(over.z).toBeGreaterThan(CROSSBAR_HEIGHT);
    expect(isGoal(wide.y, wide.z)).toBe(false);
  });

  test("a shot without the power to get there drops short of the goal", () => {
    const shot = shootAt([GOAL_CENTRE, 1], 10, ShotType.Chipped);
    expect(shot.firstLanding).toBeLessThan(PITCH_LENGTH);
  });

  test("runs onto a ball that isn't at their feet before striking it", () => {
    const world = createGame();
    const { Position, Velocity } = world.components;
    const p = addPlayer(world, 80, GOAL_CENTRE + 3);
    const b = addBall(world, 85, GOAL_CENTRE);
    setShot(world, p, PITCH_LENGTH, GOAL_CENTRE, 1, 25, ShotType.Driven);
    let gapWhenStruck = Infinity;
    while (Math.hypot(Velocity.x[b]!, Velocity.y[b]!) === 0) {
      gapWhenStruck = Math.hypot(Position.x[b]! - Position.x[p]!, Position.y[b]! - Position.y[p]!);
      step(world);
    }
    expect(gapWhenStruck).toBeLessThanOrEqual(TOUCH_REACH);
  });
});

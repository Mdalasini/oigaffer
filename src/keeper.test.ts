import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import { KEEPER_DIVE_SPEED, KEEPER_REACTION_TIME, PITCH_LENGTH, PITCH_WIDTH, STRONGEST_STRIKE_SPEED, TIME_STEP } from "./constants";
import { whereBallCrosses } from "./flight";
import { kick, type Point } from "./shooting";
import { isGoal, step } from "./systems";
import { addBall, addGoalkeeper, createGame } from "./world";

const GOAL_CENTRE = PITCH_WIDTH / 2;
const PENALTY_SPOT: Point = [PITCH_LENGTH - 11, GOAL_CENTRE, 0];
const THIRTY_METRES_OUT: Point = [PITCH_LENGTH - 30, GOAL_CENTRE, 0];
const BOTTOM_CORNER: [y: number, z: number] = [GOAL_CENTRE + 3.2, 0.4];

function shotAtKeeper(from: Point, velocity: Point) {
  const world = createGame();
  const { Position, Velocity, GoalLineCrossing, Held } = world.components;
  const keeper = addGoalkeeper(world, PITCH_LENGTH, GOAL_CENTRE);
  const ball = addBall(world, from[0], from[1]);
  Position.z[ball] = from[2];
  [Velocity.x[ball], Velocity.y[ball], Velocity.z[ball]] = velocity;
  const keeperPath: number[] = [];
  const finished = () => hasComponent(world, ball, GoalLineCrossing) || hasComponent(world, ball, Held);
  for (let time = 0; !finished() && time < 10; time += TIME_STEP) {
    step(world);
    keeperPath.push(Position.y[keeper]!);
  }
  return {
    world,
    ball,
    keeperPath,
    saved: hasComponent(world, ball, Held),
    scored: hasComponent(world, ball, GoalLineCrossing) && isGoal(GoalLineCrossing.y[ball]!, GoalLineCrossing.z[ball]!),
  };
}

const struckAt = (from: Point, aim: [y: number, z: number]) =>
  shotAtKeeper(from, kick(from, [PITCH_LENGTH, ...aim], STRONGEST_STRIKE_SPEED));

describe("a goalkeeper on the line", () => {
  test("catches a shot within reach and holds it where they caught it", () => {
    const aim: [number, number] = [GOAL_CENTRE + 0.6, 1.2];
    const { world, ball, saved } = struckAt(PENALTY_SPOT, aim);
    const { Position } = world.components;
    expect(saved).toBe(true);
    const held: Point = [Position.x[ball]!, Position.y[ball]!, Position.z[ball]!];
    expect(held[1]).toBeCloseTo(aim[0], 1);
    expect(held[2]).toBeCloseTo(aim[1], 1);
    for (let i = 0; i < 60; i++) step(world);
    expect([Position.x[ball], Position.y[ball], Position.z[ball]]).toEqual(held);
  });

  test("stands still until they've reacted, then gets across no faster than they can dive", () => {
    const { keeperPath } = struckAt(THIRTY_METRES_OUT, BOTTOM_CORNER);
    const stepsToReact = Math.ceil(KEEPER_REACTION_TIME / TIME_STEP) - 1;
    for (const y of keeperPath.slice(0, stepsToReact)) expect(y).toBe(GOAL_CENTRE);
    for (let i = 1; i < keeperPath.length; i++) {
      expect(Math.abs(keeperPath[i]! - keeperPath[i - 1]!)).toBeLessThanOrEqual(KEEPER_DIVE_SPEED * TIME_STEP + 1e-9);
    }
    expect(keeperPath.at(-1)!).toBeGreaterThan(GOAL_CENTRE + 2);
  });

  test("a hard shot into the corner from the penalty spot is in before they get there", () => {
    const { scored, saved } = struckAt(PENALTY_SPOT, BOTTOM_CORNER);
    expect(saved).toBe(false);
    expect(scored).toBe(true);
  });

  test("the same corner from thirty metres gives them time to get across and save it", () => {
    expect(struckAt(THIRTY_METRES_OUT, BOTTOM_CORNER).saved).toBe(true);
  });

  test("can't stretch to a ball going over their head", () => {
    const { saved } = struckAt(THIRTY_METRES_OUT, [GOAL_CENTRE, 3]);
    expect(saved).toBe(false);
  });

  test("doesn't move while the ball is going away from goal", () => {
    const { keeperPath } = shotAtKeeper([90, GOAL_CENTRE + 5, 0], [-10, 2, 0]);
    expect(keeperPath.every((y) => y === GOAL_CENTRE)).toBe(true);
  });
});

describe("reading the shot", () => {
  test("knows where a shot that bounces on the way will cross the line", () => {
    const from: Point = [95, GOAL_CENTRE - 2, 0];
    const velocity: Point = [14, 1.5, 3];
    const world = createGame();
    const { Velocity, GoalLineCrossing } = world.components;
    const ball = addBall(world, from[0], from[1]);
    [Velocity.x[ball], Velocity.y[ball], Velocity.z[ball]] = velocity;
    const predicted = whereBallCrosses(PITCH_LENGTH, from, velocity, TIME_STEP)!;
    let bounced = false;
    for (let time = 0; !hasComponent(world, ball, GoalLineCrossing) && time < 10; time += TIME_STEP) {
      step(world);
      if (world.components.Position.z[ball] === 0) bounced = true;
    }
    expect(bounced).toBe(true);
    expect(predicted[0]).toBeCloseTo(GoalLineCrossing.y[ball]!, 9);
    expect(predicted[1]).toBeCloseTo(GoalLineCrossing.z[ball]!, 9);
  });

  test("knows a ball that stops short will never reach the line", () => {
    expect(whereBallCrosses(PITCH_LENGTH, [90, GOAL_CENTRE, 0], [3, 0, 0], TIME_STEP)).toBeNull();
  });
});

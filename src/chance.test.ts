import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import { AVERAGE_SHOOTING_GRADE, BEST_SHOOTING_GRADE, GOAL_WIDTH, PITCH_LENGTH, TIME_STEP } from "./constants";
import { bestChanceAroundOnceKeeperIsSet, bestShot, chanceAgainst, missesInCircle, shotOptions, type Keeper } from "./chance";
import { GOAL_CENTRE, isGoal } from "./goal";
import { kick, spreadRadius, strikeSpeed, type Point } from "./shooting";
import { step } from "./systems";
import { addBall, addDefender, addGoalkeeper, createGame, strikeBall } from "./world";

const PENALTY_SPOT: Point = [PITCH_LENGTH - 11, GOAL_CENTRE, 0];
const KEEPER_ON_THE_LINE: Keeper = [PITCH_LENGTH, GOAL_CENTRE];

const optionNearest = (from: Point, grade: number, y: number, z: number) =>
  shotOptions(from, grade).reduce((best, option) =>
    Math.hypot(option.aim[1] - y, option.aim[2] - z) < Math.hypot(best.aim[1] - y, best.aim[2] - z) ? option : best,
  );

function goalsWhenShotFor(from: Point, aim: Point, grade: number, keeper: Keeper, defenders: [number, number][] = []): number {
  return missesInCircle(from, aim, spreadRadius(grade, from, aim)).filter((miss) => {
    const world = createGame();
    const { GoalLineCrossing, Held, Blocked } = world.components;
    addGoalkeeper(world, ...keeper);
    for (const defender of defenders) addDefender(world, ...defender);
    const ball = addBall(world, from[0], from[1]);
    strikeBall(world, ball, kick(from, miss, strikeSpeed(grade)));
    for (let time = 0; time < 5 && ![GoalLineCrossing, Held, Blocked].some((part) => hasComponent(world, ball, part)); time += TIME_STEP) {
      step(world);
    }
    return hasComponent(world, ball, GoalLineCrossing) && isGoal(GoalLineCrossing.y[ball]!, GoalLineCrossing.z[ball]!);
  }).length;
}

describe("the chance a shot goes in", () => {
  test("into an empty goal, a good shooter aiming at the middle can't miss", () => {
    expect(chanceAgainst(optionNearest(PENALTY_SPOT, BEST_SHOOTING_GRADE, GOAL_CENTRE, 1.2), null)).toBe(1);
  });

  test("aiming at the post, some of the shooter's circle goes wide", () => {
    const atThePost = optionNearest(PENALTY_SPOT, AVERAGE_SHOOTING_GRADE, GOAL_CENTRE + GOAL_WIDTH / 2, 1.2);
    const chance = chanceAgainst(atThePost, null);
    expect(chance).toBeGreaterThan(0.2);
    expect(chance).toBeLessThan(0.9);
  });

  test("from thirty metres, a keeper in the middle of goal has time to reach anything", () => {
    const from: Point = [PITCH_LENGTH - 30, GOAL_CENTRE, 0];
    expect(bestShot(shotOptions(from, AVERAGE_SHOOTING_GRADE), KEEPER_ON_THE_LINE).chance).toBe(0);
  });

  test("from the penalty spot, the best place to aim is away from the keeper, towards a corner", () => {
    const { aim, chance } = bestShot(shotOptions(PENALTY_SPOT, BEST_SHOOTING_GRADE), KEEPER_ON_THE_LINE);
    expect(Math.abs(aim[1] - GOAL_CENTRE)).toBeGreaterThan(2.5);
    expect(chance).toBeGreaterThan(0.5);
  });

  test("matches what really happens when each ball in the circle is struck at the keeper", () => {
    const from: Point = [PITCH_LENGTH - 16, GOAL_CENTRE + 6, 0];
    const keeper: Keeper = [PITCH_LENGTH - 2, GOAL_CENTRE + 1];
    for (const option of shotOptions(from, AVERAGE_SHOOTING_GRADE)) {
      const estimated = chanceAgainst(option, keeper) * option.misses.length;
      expect(estimated).toBe(goalsWhenShotFor(from, option.aim, AVERAGE_SHOOTING_GRADE, keeper));
    }
  });

  test("matches what really happens when a defender stands in the way as well", () => {
    const from: Point = [PITCH_LENGTH - 18, GOAL_CENTRE - 4, 0];
    const keeper: Keeper = [PITCH_LENGTH - 1, GOAL_CENTRE - 1];
    const defenders: [number, number][] = [[PITCH_LENGTH - 14, GOAL_CENTRE - 2.5]];
    let blockedSome = false;
    for (const option of shotOptions(from, AVERAGE_SHOOTING_GRADE)) {
      const estimated = chanceAgainst(option, keeper, TIME_STEP, defenders) * option.misses.length;
      blockedSome ||= estimated < chanceAgainst(option, keeper) * option.misses.length;
      expect(estimated).toBe(goalsWhenShotFor(from, option.aim, AVERAGE_SHOOTING_GRADE, keeper, defenders));
    }
    expect(blockedSome).toBe(true);
  });
});

describe("the chance from a spot once the keeper is set", () => {
  test("has no holes: a metre further on or across never halves or doubles it", () => {
    const chanceAt = (x: number, y: number) => bestChanceAroundOnceKeeperIsSet([x, y, 0], AVERAGE_SHOOTING_GRADE, true);
    for (let x = PITCH_LENGTH - 17; x <= PITCH_LENGTH - 8; x++) {
      for (let y = GOAL_CENTRE - 6; y <= GOAL_CENTRE + 6; y++) {
        expect(Math.abs(chanceAt(x + 1, y) - chanceAt(x, y))).toBeLessThan(0.5);
        expect(Math.abs(chanceAt(x, y + 1) - chanceAt(x, y))).toBeLessThan(0.5);
      }
    }
  });

  test("is best close to goal and in front of it", () => {
    const chanceAt = (x: number, y: number) => bestChanceAroundOnceKeeperIsSet([x, y, 0], AVERAGE_SHOOTING_GRADE, true);
    expect(chanceAt(PITCH_LENGTH - 13, GOAL_CENTRE)).toBeGreaterThan(chanceAt(PITCH_LENGTH - 20, GOAL_CENTRE));
    expect(chanceAt(PITCH_LENGTH - 13, GOAL_CENTRE)).toBeGreaterThan(chanceAt(PITCH_LENGTH - 13, GOAL_CENTRE + 10));
  });
});

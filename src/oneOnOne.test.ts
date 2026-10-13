import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import { AVERAGE_SHOOTING_GRADE, PITCH_LENGTH, TIME_STEP } from "./constants";
import { GOAL_CENTRE } from "./goal";
import { step } from "./systems";
import { addBall, addGoalkeeper, addPlayer, createGame, setAttacking } from "./world";

function oneOnOne(attackerAt: [x: number, y: number], keeperAt: [x: number, y: number] | null, seconds = 10) {
  const world = createGame();
  const { Position, Struck, Held, GoalLineCrossing, Velocity } = world.components;
  const attacker = addPlayer(world, attackerAt[0] - 0.3, attackerAt[1], 0, AVERAGE_SHOOTING_GRADE);
  const ball = addBall(world, ...attackerAt);
  const keeper = keeperAt && addGoalkeeper(world, ...keeperAt);
  setAttacking(world, attacker);
  let struckFrom: [number, number] | null = null;
  let struckTowards: [number, number] | null = null;
  for (let time = 0; time < seconds && !hasComponent(world, ball, GoalLineCrossing) && !hasComponent(world, ball, Held); time += TIME_STEP) {
    step(world);
    if (!struckFrom && hasComponent(world, ball, Struck)) {
      struckFrom = [Position.x[ball]!, Position.y[ball]!];
      struckTowards = [Velocity.x[ball]!, Velocity.y[ball]!];
    }
  }
  return { world, ball, attacker, keeper, struckFrom, struckTowards };
}

describe("an attacker through on goal", () => {
  test("out of range, keeps dribbling towards goal instead of shooting", () => {
    const { struckFrom, world, attacker } = oneOnOne([40, GOAL_CENTRE], [PITCH_LENGTH, GOAL_CENTRE], 1);
    expect(struckFrom).toBeNull();
    expect(world.components.Position.x[attacker]!).toBeGreaterThan(40);
  });

  test("against a keeper on the line, gets closer before shooting, and shoots before reaching the keeper", () => {
    const { struckFrom } = oneOnOne([PITCH_LENGTH - 30, GOAL_CENTRE + 5], [PITCH_LENGTH, GOAL_CENTRE]);
    expect(struckFrom).not.toBeNull();
    const distance = Math.hypot(PITCH_LENGTH - struckFrom![0], GOAL_CENTRE - struckFrom![1]);
    expect(distance).toBeLessThan(25);
    expect(distance).toBeGreaterThan(2);
  });

  test("aims for the side of the goal the keeper is furthest from", () => {
    const { struckFrom, struckTowards } = oneOnOne([PITCH_LENGTH - 20, GOAL_CENTRE], [PITCH_LENGTH, GOAL_CENTRE - 2]);
    const [fromX, fromY] = struckFrom!;
    const [vx, vy] = struckTowards!;
    const crossesAt = fromY + (vy / vx) * (PITCH_LENGTH - fromX);
    expect(crossesAt).toBeGreaterThan(GOAL_CENTRE + 1);
  });

  test("into an empty goal, shoots as soon as they can't miss", () => {
    const { struckFrom } = oneOnOne([PITCH_LENGTH - 30, GOAL_CENTRE], null);
    expect(PITCH_LENGTH - struckFrom![0]).toBeGreaterThan(20);
  });
});

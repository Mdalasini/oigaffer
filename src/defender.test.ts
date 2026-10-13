import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import {
  AVERAGE_GRADE,
  BEST_GRADE,
  HIGHEST_BLOCK,
  PITCH_LENGTH,
  STRONGEST_STRIKE_SPEED,
  TACKLE_REACH,
  TACKLE_RECOVERY_TIME,
  TIME_STEP,
  WORST_GRADE,
} from "./constants";
import { bestShot, shotOptions } from "./chance";
import { tackleWinChance } from "./defender";
import { GOAL_CENTRE } from "./goal";
import { kick, type Point } from "./shooting";
import { step } from "./systems";
import { addBall, addDefender, addGoalkeeper, addPlayer, createGame, setAttacking, setDribble, strikeBall } from "./world";

describe("the tackle contest", () => {
  test("is even between an average dribbler and an average tackler", () => {
    expect(tackleWinChance(AVERAGE_GRADE, AVERAGE_GRADE)).toBe(0.5);
  });

  test("goes the way of the better player, but is never a certainty", () => {
    const lopsided = tackleWinChance(BEST_GRADE, WORST_GRADE);
    expect(lopsided).toBeGreaterThan(0.8);
    expect(lopsided).toBeLessThan(1);
    expect(tackleWinChance(WORST_GRADE, BEST_GRADE)).toBeCloseTo(1 - lopsided, 9);
    expect(tackleWinChance(AVERAGE_GRADE + 3, AVERAGE_GRADE)).toBeGreaterThan(0.5);
  });
});

function dribbleAtDefender({ dribbling = AVERAGE_GRADE, tackling = AVERAGE_GRADE, seed = 1, seconds = 6 } = {}) {
  const world = createGame(seed);
  const { Position, Grounded, Tackled } = world.components;
  const attacker = addPlayer(world, 59.7, GOAL_CENTRE, 0, AVERAGE_GRADE, dribbling);
  const ball = addBall(world, 60, GOAL_CENTRE);
  const defender = addDefender(world, 70, GOAL_CENTRE + 2, Math.PI, tackling);
  setDribble(world, attacker, PITCH_LENGTH, GOAL_CENTRE);
  let tackleAt: { ball: [number, number]; defender: [number, number]; time: number } | null = null;
  let time = 0;
  const defenderSteps: [number, number][] = [];
  for (; time < seconds; time += TIME_STEP) {
    const before = { ball: [Position.x[ball]!, Position.y[ball]!] as [number, number], defender: [Position.x[defender]!, Position.y[defender]!] as [number, number] };
    step(world);
    defenderSteps.push([Position.x[defender]!, Position.y[defender]!]);
    if (!tackleAt && (hasComponent(world, defender, Grounded) || hasComponent(world, attacker, Tackled))) tackleAt = { ...before, time };
  }
  return { world, attacker, ball, defender, tackleAt, defenderSteps, won: hasComponent(world, attacker, Tackled) };
}

describe("a defender facing a dribbler", () => {
  test("comes out to meet them and goes into a tackle once the ball is within reach", () => {
    const { tackleAt } = dribbleAtDefender();
    expect(tackleAt).not.toBeNull();
    const [ballX, ballY] = tackleAt!.ball;
    const [defenderX, defenderY] = tackleAt!.defender;
    expect(Math.hypot(ballX - defenderX, ballY - defenderY)).toBeLessThan(TACKLE_REACH + 0.2);
    expect(defenderX).toBeLessThan(70);
  });

  test("wins the ball about as often as the grades say", () => {
    const tries = 60;
    const winsFor = (tackling: number, dribbling: number) =>
      Array.from({ length: tries }, (_, seed) => dribbleAtDefender({ tackling, dribbling, seed: seed + 1, seconds: 3 }).won).filter(Boolean).length / tries;
    expect(winsFor(BEST_GRADE, WORST_GRADE)).toBeGreaterThan(0.75);
    expect(winsFor(WORST_GRADE, BEST_GRADE)).toBeLessThan(0.25);
    expect(Math.abs(winsFor(AVERAGE_GRADE, AVERAGE_GRADE) - 0.5)).toBeLessThan(0.2);
  });

  test("when they win it, clears the ball away from goal and the dribbler pulls up", () => {
    const { world, attacker, ball } = dribbleAtDefender({ tackling: BEST_GRADE, dribbling: WORST_GRADE });
    const { Velocity, Dribble } = world.components;
    expect(hasComponent(world, attacker, Dribble)).toBe(false);
    expect(Math.hypot(Velocity.x[attacker]!, Velocity.y[attacker]!)).toBe(0);
    expect(world.components.Position.x[ball]!).toBeLessThan(60);
  });

  test("when they're beaten, they're left on the ground while the dribbler goes past, then get up and chase", () => {
    const run = dribbleAtDefender({ tackling: WORST_GRADE, dribbling: BEST_GRADE, seed: 2 });
    expect(run.won).toBe(false);
    const { world, attacker, defender, defenderSteps, tackleAt } = run;
    const firstDown = Math.round(tackleAt!.time / TIME_STEP);
    const stepsDown = Math.floor(TACKLE_RECOVERY_TIME / TIME_STEP) - 1;
    const down = defenderSteps.slice(firstDown, firstDown + stepsDown);
    for (const spot of down) expect(spot).toEqual(down[0]!);
    expect(defenderSteps.at(-1)![0]).toBeGreaterThan(down[0]![0] + 1);
    const { Position } = world.components;
    expect(Position.x[attacker]!).toBeGreaterThan(Position.x[defender]!);
  });
});

function shotPastDefender(from: Point, aim: Point, defenderAt: [number, number]) {
  const world = createGame();
  const { Position, Blocked, GoalLineCrossing } = world.components;
  addDefender(world, ...defenderAt);
  const ball = addBall(world, from[0], from[1]);
  strikeBall(world, ball, kick(from, aim, STRONGEST_STRIKE_SPEED));
  for (let time = 0; time < 3 && !hasComponent(world, ball, Blocked) && !hasComponent(world, ball, GoalLineCrossing); time += TIME_STEP) step(world);
  return { blocked: hasComponent(world, ball, Blocked), at: [Position.x[ball]!, Position.y[ball]!, Position.z[ball]!] };
}

describe("a defender in the way of a shot", () => {
  const from: Point = [PITCH_LENGTH - 20, GOAL_CENTRE, 0];

  test("blocks a shot struck at them and stops it dead", () => {
    const { blocked, at } = shotPastDefender(from, [PITCH_LENGTH, GOAL_CENTRE, 0.5], [PITCH_LENGTH - 17, GOAL_CENTRE + 0.2]);
    expect(blocked).toBe(true);
    expect(at[0]).toBeCloseTo(PITCH_LENGTH - 17, 0);
  });

  test("can't block a shot that goes past them or over their head", () => {
    expect(shotPastDefender(from, [PITCH_LENGTH, GOAL_CENTRE - 3, 0.5], [PITCH_LENGTH - 5, GOAL_CENTRE + 0.5]).blocked).toBe(false);
    expect(shotPastDefender(from, [PITCH_LENGTH, GOAL_CENTRE, HIGHEST_BLOCK + 3], [PITCH_LENGTH - 2, GOAL_CENTRE]).blocked).toBe(false);
  });

  test("makes the shooter aim away from them, and lowers the chance of scoring", () => {
    const shooter: Point = [PITCH_LENGTH - 12, GOAL_CENTRE, 0];
    const keeper: [number, number] = [PITCH_LENGTH, GOAL_CENTRE];
    const options = shotOptions(shooter, AVERAGE_GRADE);
    const open = bestShot(options, keeper);
    const defenderOnTheLine: [number, number] = [PITCH_LENGTH - 10, GOAL_CENTRE + (open.aim[1] - GOAL_CENTRE) / 6];
    const blocked = bestShot(options, keeper, TIME_STEP, [defenderOnTheLine]);
    expect(blocked.chance).toBeLessThan(open.chance);
    expect(Math.sign(blocked.aim[1] - GOAL_CENTRE)).toBe(-Math.sign(open.aim[1] - GOAL_CENTRE));
  });
});

function attackPastDefender(attackerAt: [number, number], defenderAt: [number, number], grades: { shooting?: number; dribbling?: number; tackling?: number }) {
  const world = createGame();
  const { Position, Struck, Held, GoalLineCrossing, Grounded, Tackled, Blocked } = world.components;
  const attacker = addPlayer(world, attackerAt[0] - 0.3, attackerAt[1], 0, grades.shooting ?? AVERAGE_GRADE, grades.dribbling ?? AVERAGE_GRADE);
  const ball = addBall(world, ...attackerAt);
  const defender = addDefender(world, ...defenderAt, Math.PI, grades.tackling ?? AVERAGE_GRADE);
  addGoalkeeper(world, PITCH_LENGTH, GOAL_CENTRE);
  setAttacking(world, attacker);
  let first: { what: "shot" | "tackle"; from: number } | null = null;
  let closestWhileDown = Infinity;
  const over = () => [GoalLineCrossing, Held, Blocked].some((part) => hasComponent(world, ball, part)) || hasComponent(world, attacker, Tackled);
  for (let time = 0; time < 10 && !over(); time += TIME_STEP) {
    step(world);
    const out = PITCH_LENGTH - Position.x[ball]!;
    if (!first && hasComponent(world, ball, Struck)) first = { what: "shot", from: out };
    if (!first && (hasComponent(world, defender, Grounded) || hasComponent(world, attacker, Tackled))) first = { what: "tackle", from: out };
    if (hasComponent(world, defender, Grounded)) {
      const apart = Math.hypot(Position.x[attacker]! - Position.x[defender]!, Position.y[attacker]! - Position.y[defender]!);
      closestWhileDown = Math.min(closestWhileDown, apart);
    }
  }
  return { first, closestWhileDown };
}

describe("an attacker with a defender between them and goal", () => {
  test("takes on a defender they're likely to beat rather than shoot from distance", () => {
    const { first } = attackPastDefender([PITCH_LENGTH - 25, GOAL_CENTRE], [PITCH_LENGTH - 17, GOAL_CENTRE], { dribbling: BEST_GRADE, tackling: WORST_GRADE });
    expect(first?.what).toBe("tackle");
  });

  test("goes round a defender they've beaten, not through them", () => {
    const { closestWhileDown } = attackPastDefender([PITCH_LENGTH - 25, GOAL_CENTRE], [PITCH_LENGTH - 17, GOAL_CENTRE], { dribbling: BEST_GRADE, tackling: WORST_GRADE });
    expect(closestWhileDown).toBeLessThan(Infinity);
    expect(closestWhileDown).toBeGreaterThan(0.4);
  });

  test("shoots from distance rather than run into a defender who will probably win the ball", () => {
    const { first } = attackPastDefender([PITCH_LENGTH - 26, GOAL_CENTRE], [PITCH_LENGTH - 14, GOAL_CENTRE + 6], {
      shooting: BEST_GRADE,
      dribbling: WORST_GRADE,
      tackling: BEST_GRADE,
    });
    expect(first?.what).toBe("shot");
    expect(first!.from).toBeGreaterThan(17);
  });

  test("with the defender too far away to get there in time, runs on in for a closer shot", () => {
    const { first } = attackPastDefender([PITCH_LENGTH - 26, GOAL_CENTRE], [PITCH_LENGTH - 45, GOAL_CENTRE], {
      shooting: BEST_GRADE,
      dribbling: WORST_GRADE,
      tackling: BEST_GRADE,
    });
    expect(first?.what).toBe("shot");
    expect(first!.from).toBeLessThan(17);
  });
});

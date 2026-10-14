import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import { AVERAGE_SHOOTING_GRADE, KEEPER_DIVE_SPEED, KEEPER_REACH, KEEPER_REACTION_TIME, PITCH_LENGTH, PITCH_WIDTH, STRONGEST_STRIKE_SPEED, TIME_STEP } from "./constants";
import { bestShot, shotOptions } from "./chance";
import { GOAL_LINE, whereBallCrosses } from "./flight";
import { kick, type Point } from "./shooting";
import { isGoal } from "./goal";
import { step } from "./systems";
import { addBall, addGoalkeeper, addPlayer, addTeam, createGame, DOWN_THE_PITCH, UP_THE_PITCH, joinTeam, strikeBall } from "./world";

const GOAL_CENTRE = PITCH_WIDTH / 2;
const PENALTY_SPOT: Point = [PITCH_LENGTH - 11, GOAL_CENTRE, 0];
const THIRTY_METRES_OUT: Point = [PITCH_LENGTH - 30, GOAL_CENTRE, 0];
const BOTTOM_CORNER: [y: number, z: number] = [GOAL_CENTRE + 3.2, 0.4];

function shotAtKeeper(from: Point, velocity: Point, keeperAt: [x: number, y: number] = [PITCH_LENGTH, GOAL_CENTRE], struck = true) {
  const world = createGame();
  const { Position, Velocity, GoalLineCrossing, Held } = world.components;
  const keeper = addGoalkeeper(world, ...keeperAt);
  const ball = addBall(world, from[0], from[1]);
  Position.z[ball] = from[2];
  if (struck) strikeBall(world, ball, velocity);
  else [Velocity.x[ball], Velocity.y[ball], Velocity.z[ball]] = velocity;
  const keeperPath: number[] = [];
  const keeperSteps: [number, number][] = [];
  const finished = () => hasComponent(world, ball, GoalLineCrossing) || hasComponent(world, ball, Held);
  for (let time = 0; !finished() && time < 10; time += TIME_STEP) {
    step(world);
    keeperPath.push(Position.y[keeper]!);
    keeperSteps.push([Position.x[keeper]!, Position.y[keeper]!]);
  }
  return {
    world,
    ball,
    keeper,
    keeperPath,
    keeperSteps,
    saved: hasComponent(world, ball, Held),
    scored: hasComponent(world, ball, GoalLineCrossing) && isGoal(GoalLineCrossing.y[ball]!, GoalLineCrossing.z[ball]!),
  };
}

const struckFrom = (from: Point, aim: [y: number, z: number], keeperAt?: [x: number, y: number]) =>
  shotAtKeeper(from, kick(from, [PITCH_LENGTH, ...aim], STRONGEST_STRIKE_SPEED), keeperAt);
const struckAt = (from: Point, aim: [y: number, z: number]) => struckFrom(from, aim);

describe("a goalkeeper on the line", () => {
  test("catches a shot within reach and holds it where they caught it", () => {
    const aim: [number, number] = [GOAL_CENTRE + 0.6, 1.2];
    const { world, ball, keeper, saved } = struckAt(PENALTY_SPOT, aim);
    const { Position } = world.components;
    expect(saved).toBe(true);
    const held: Point = [Position.x[ball]!, Position.y[ball]!, Position.z[ball]!];
    expect(Math.hypot(held[0] - Position.x[keeper]!, held[1] - Position.y[keeper]!)).toBeLessThanOrEqual(KEEPER_REACH);
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

  test("doesn't dive at a ball that hasn't been struck", () => {
    const { keeperPath } = shotAtKeeper([90, GOAL_CENTRE + 5, 0], [6, -1, 0], undefined, false);
    expect(keeperPath.every((y) => y === GOAL_CENTRE)).toBe(true);
  });

  test("claims a loose ball that rolls within reach", () => {
    const { saved } = shotAtKeeper([PITCH_LENGTH - 8, GOAL_CENTRE + 0.5, 0], [5, 0, 0], undefined, false);
    expect(saved).toBe(true);
  });
});

describe("a goalkeeper off their line", () => {
  const keeperAt: [number, number] = [PITCH_LENGTH - 6, GOAL_CENTRE];

  test("dives to meet the shot's path rather than along the goal line", () => {
    const from: Point = [PITCH_LENGTH - 20, GOAL_CENTRE - 12, 0];
    const aim: Point = [PITCH_LENGTH, GOAL_CENTRE + 3, 0.5];
    const { keeperSteps } = struckFrom(from, [aim[1], aim[2]], keeperAt);
    const fromThePath = ([x, y]: [number, number]) =>
      Math.abs((x - from[0]) * (aim[1] - from[1]) - (y - from[1]) * (aim[0] - from[0])) / Math.hypot(aim[0] - from[0], aim[1] - from[1]);
    const [startX] = keeperSteps[0]!;
    const [endX] = keeperSteps.at(-1)!;
    expect(fromThePath(keeperSteps.at(-1)!)).toBeLessThan(fromThePath(keeperSteps[0]!) - 0.3);
    expect(endX).toBeLessThan(startX);
  });

  test("catches a shot in front of them, well before it reaches the goal line", () => {
    const { world, ball, saved } = struckFrom([PITCH_LENGTH - 25, GOAL_CENTRE, 0], [GOAL_CENTRE - 1.5, 0.8], keeperAt);
    expect(saved).toBe(true);
    expect(world.components.Position.x[ball]!).toBeLessThan(keeperAt[0]);
  });
});

describe("reading the shot", () => {
  test("knows where a shot that bounces on the way will cross the line", () => {
    const from: Point = [95, GOAL_CENTRE - 2, 0];
    const velocity: Point = [14, 1.5, 3];
    const world = createGame();
    const { GoalLineCrossing } = world.components;
    const ball = addBall(world, from[0], from[1]);
    strikeBall(world, ball, velocity);
    const predicted = whereBallCrosses(GOAL_LINE, from, velocity, TIME_STEP)!;
    let bounced = false;
    for (let time = 0; !hasComponent(world, ball, GoalLineCrossing) && time < 10; time += TIME_STEP) {
      step(world);
      if (world.components.Position.z[ball] === 0) bounced = true;
    }
    expect(bounced).toBe(true);
    expect(predicted[1]).toBeCloseTo(GoalLineCrossing.y[ball]!, 9);
    expect(predicted[2]).toBeCloseTo(GoalLineCrossing.z[ball]!, 9);
  });

  test("knows a ball that stops short will never reach the line", () => {
    expect(whereBallCrosses(GOAL_LINE, [90, GOAL_CENTRE, 0], [3, 0, 0], TIME_STEP)).toBeNull();
  });
});

describe("a goalkeeper taking up position", () => {
  function settleAgainst(ballAt: [x: number, y: number]) {
    const world = createGame();
    const { Position } = world.components;
    const [home, away] = [addTeam(world, UP_THE_PITCH), addTeam(world, DOWN_THE_PITCH)];
    joinTeam(world, addPlayer(world, ballAt[0] - 0.3, ballAt[1]), home);
    addBall(world, ...ballAt);
    const keeper = joinTeam(world, addGoalkeeper(world, PITCH_LENGTH, GOAL_CENTRE), away);
    for (let time = 0; time < 4; time += TIME_STEP) step(world);
    return [Position.x[keeper]!, Position.y[keeper]!] as [number, number];
  }

  const chanceAgainst = (from: Point, keeper: [number, number]) => bestShot(shotOptions(from, AVERAGE_SHOOTING_GRADE), keeper).chance;

  test("stays on the line, shuffled towards the ball's side, while the shooter is far out", () => {
    const [x, y] = settleAgainst([PITCH_LENGTH - 35, GOAL_CENTRE + 15]);
    expect(x).toBeGreaterThan(PITCH_LENGTH - 0.5);
    expect(y).toBeGreaterThan(GOAL_CENTRE);
  });

  test("doesn't run out through ground where the shooter would have a better chance", () => {
    const ballAt: Point = [PITCH_LENGTH - 14, GOAL_CENTRE + 3, 0];
    const settled = settleAgainst([ballAt[0], ballAt[1]]);
    expect(settled[0]).toBeGreaterThan(PITCH_LENGTH - 1);
    expect(chanceAgainst(ballAt, settled)).toBeLessThanOrEqual(chanceAgainst(ballAt, [PITCH_LENGTH, GOAL_CENTRE]));
  });

  test("rushes out at a shooter close enough to beat them from the line", () => {
    const ballAt: Point = [PITCH_LENGTH - 9, GOAL_CENTRE, 0];
    expect(chanceAgainst(ballAt, [PITCH_LENGTH, GOAL_CENTRE])).toBe(1);
    const settled = settleAgainst([ballAt[0], ballAt[1]]);
    expect(Math.hypot(settled[0] - ballAt[0], settled[1] - ballAt[1])).toBeLessThan(3);
    expect(chanceAgainst(ballAt, settled)).toBeLessThan(0.5);
  });
});

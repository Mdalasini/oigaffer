import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import { PITCH_LENGTH, TIME_STEP } from "./constants";
import { GOAL_CENTRE } from "./goal";
import { step } from "./systems";
import { opponentsOf, teammatesOf } from "./teams";
import { addBall, addDefender, addGoalkeeper, addPlayer, addTeam, createGame, DOWN_THE_PITCH, joinTeam, setDribble, setInPossession, UP_THE_PITCH } from "./world";

describe("team membership", () => {
  test("teammates are the others on the same team, and opponents everyone on another", () => {
    const world = createGame();
    const { Position } = world.components;
    const [home, away] = [addTeam(world, UP_THE_PITCH), addTeam(world, DOWN_THE_PITCH)];
    const carrier = joinTeam(world, addPlayer(world, 60, GOAL_CENTRE), home);
    const mate = joinTeam(world, addPlayer(world, 60, GOAL_CENTRE + 8), home);
    const defender = joinTeam(world, addDefender(world, 70, GOAL_CENTRE), away);
    const keeper = joinTeam(world, addGoalkeeper(world, PITCH_LENGTH, GOAL_CENTRE), away);
    expect(teammatesOf(world, carrier, [Position])).toEqual([mate]);
    expect(opponentsOf(world, carrier, [Position]).sort()).toEqual([defender, keeper].sort());
    expect(opponentsOf(world, defender, [Position]).sort()).toEqual([carrier, mate].sort());
  });

  test("a defender leaves a teammate on the ball alone", () => {
    const world = createGame();
    const { Grounded, Tackled } = world.components;
    const team = addTeam(world, UP_THE_PITCH);
    const dribbler = joinTeam(world, addPlayer(world, 59.7, GOAL_CENTRE), team);
    addBall(world, 60, GOAL_CENTRE);
    const defender = joinTeam(world, addDefender(world, 63, GOAL_CENTRE), team);
    setDribble(world, dribbler, PITCH_LENGTH, GOAL_CENTRE);
    for (let time = 0; time < 3; time += TIME_STEP) {
      step(world);
      expect(hasComponent(world, defender, Grounded) || hasComponent(world, dribbler, Tackled)).toBe(false);
    }
  });
});

function attackingDownThePitch(defendersAt: [number, number][]) {
  const world = createGame();
  const [attacking, defending] = [addTeam(world, DOWN_THE_PITCH), addTeam(world, UP_THE_PITCH)];
  const carrier = joinTeam(world, addPlayer(world, 45.3, GOAL_CENTRE, Math.PI), attacking);
  const mate = joinTeam(world, addPlayer(world, 45, GOAL_CENTRE + 6, Math.PI), attacking);
  const ball = addBall(world, 45, GOAL_CENTRE);
  const defenders = defendersAt.map((at) => joinTeam(world, addDefender(world, ...at, 0), defending));
  setDribble(world, carrier, 0, GOAL_CENTRE);
  setInPossession(world, attacking);
  return { world, mate, ball, defenders };
}

describe("a team attacking down the pitch", () => {
  test("has its supporter stay level with the second-last opponent rather than beyond them", () => {
    const { world, mate, ball, defenders } = attackingDownThePitch([[44, GOAL_CENTRE - 10], [5, GOAL_CENTRE]]);
    const { Position, Target } = world.components;
    for (let time = 0; time < 1; time += TIME_STEP) {
      step(world);
      const line = Math.min(Position.x[ball]!, Position.x[defenders[0]!]!);
      expect(Target.x[mate]!).toBeGreaterThanOrEqual(line - 0.2);
    }
  });

  test("is closed down from the goal-side of the goal it attacks", () => {
    const { world, ball, defenders } = attackingDownThePitch([[35, GOAL_CENTRE]]);
    const { Position, Target } = world.components;
    step(world);
    expect(Target.x[defenders[0]!]!).toBeLessThan(Position.x[ball]!);
  });
});

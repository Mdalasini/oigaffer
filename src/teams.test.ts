import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import { PITCH_LENGTH, TIME_STEP } from "./constants";
import { GOAL_CENTRE } from "./goal";
import { step } from "./systems";
import { opponentsOf, teammatesOf } from "./teams";
import { addBall, addDefender, addGoalkeeper, addPlayer, addTeam, createGame, joinTeam, setDribble } from "./world";

describe("team membership", () => {
  test("teammates are the others on the same team, and opponents everyone on another", () => {
    const world = createGame();
    const { Position } = world.components;
    const [home, away] = [addTeam(world), addTeam(world)];
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
    const team = addTeam(world);
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

import { describe, expect, test } from "bun:test";
import { hasComponent } from "bitecs";
import { TIME_STEP } from "./constants";
import { GOAL_CENTRE } from "./goal";
import { step } from "./systems";
import { addBall, addDefender, addPlayer, addTeam, createGame, DOWN_THE_PITCH, joinTeam, setAttacking, setPassing, UP_THE_PITCH } from "./world";

function passingSide(defenderAt: [number, number] | null = null) {
  const world = createGame();
  const [home, away] = [addTeam(world, UP_THE_PITCH), addTeam(world, DOWN_THE_PITCH)];
  const carrier = joinTeam(world, addPlayer(world, 59.7, GOAL_CENTRE), home);
  const mate = joinTeam(world, addPlayer(world, 60, GOAL_CENTRE + 10), home);
  const opponent = joinTeam(world, addPlayer(world, 75, GOAL_CENTRE + 5, Math.PI), away);
  const ball = addBall(world, 60, GOAL_CENTRE);
  if (defenderAt) joinTeam(world, addDefender(world, ...defenderAt), away);
  setAttacking(world, carrier);
  return { world, carrier, mate, opponent, ball };
}

describe("what each player contributes", () => {
  test("with the ball on their team, the player on it carries and a teammate offers to receive", () => {
    const { world, carrier, mate, opponent } = passingSide();
    const { Attacking, Supporting } = world.components;
    step(world);
    expect(hasComponent(world, carrier, Attacking)).toBe(true);
    expect(hasComponent(world, carrier, Supporting)).toBe(false);
    expect(hasComponent(world, mate, Supporting)).toBe(true);
    expect(hasComponent(world, opponent, Supporting)).toBe(false);
  });

  test("once a pass is played, the passer offers to receive and the receiver goes to meet it", () => {
    const { world, carrier, mate, ball } = passingSide();
    const { Passed, Receiving, Supporting } = world.components;
    setPassing(world, carrier, mate);
    while (!hasComponent(world, ball, Passed)) step(world);
    step(world);
    expect(hasComponent(world, carrier, Supporting)).toBe(true);
    expect(hasComponent(world, mate, Receiving)).toBe(true);
    expect(hasComponent(world, mate, Supporting)).toBe(false);
  });

  test("a team that loses the ball stops offering to receive", () => {
    const { world, carrier, mate, ball } = passingSide([60, GOAL_CENTRE + 5]);
    const { Intercepted, Supporting } = world.components;
    setPassing(world, carrier, mate);
    for (let time = 0; time < 2 && !hasComponent(world, ball, Intercepted); time += TIME_STEP) step(world);
    expect(hasComponent(world, ball, Intercepted)).toBe(true);
    step(world);
    expect(hasComponent(world, carrier, Supporting)).toBe(false);
    expect(hasComponent(world, mate, Supporting)).toBe(false);
  });
});

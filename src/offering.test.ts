import { describe, expect, test } from "bun:test";
import { addComponent } from "bitecs";
import { TIME_STEP } from "./constants";
import { GOAL_CENTRE } from "./goal";
import { offerAim, predictRun, type Scene } from "./offering";
import { interceptionOf, leadPass, passFlight } from "./passing";
import { step } from "./systems";
import { addBall, addDefender, addPlayer, addTeam, createGame, DOWN_THE_PITCH, joinTeam, setInPossession, setDribble, UP_THE_PITCH } from "./world";

const emptyScene = (forward: number): Scene => ({ ball: [50, GOAL_CENTRE], path: [0, 0], carried: false, forward, defenders: [], standingOpponents: [], keeper: null });

describe("an offer to receive", () => {
  test("ahead of the ball is towards the goal the team attacks", () => {
    expect(offerAim({ along: 4, across: 6 }, emptyScene(UP_THE_PITCH), 0).x).toBe(54);
    expect(offerAim({ along: 4, across: 6 }, emptyScene(DOWN_THE_PITCH), 0).x).toBe(46);
  });

  test("is run the way it was predicted when the play goes as expected", () => {
    const world = createGame();
    const { Position, Velocity, Facing, Supporting } = world.components;
    const team = addTeam(world, UP_THE_PITCH);
    const carrier = joinTeam(world, addPlayer(world, 59.7, GOAL_CENTRE), team);
    const mate = joinTeam(world, addPlayer(world, 56, GOAL_CENTRE + 6), team);
    const ball = addBall(world, 60, GOAL_CENTRE);
    setDribble(world, carrier, 105, GOAL_CENTRE);
    setInPossession(world, team);
    for (let time = 0; time < 2; time += TIME_STEP) step(world);
    const offer = { along: Supporting.along[mate]!, across: Supporting.across[mate]! };
    const scene: Scene = { ...emptyScene(UP_THE_PITCH), ball: [Position.x[ball]!, Position.y[ball]!], path: [Velocity.x[carrier]!, Velocity.y[carrier]!], carried: true };
    const body = { x: Position.x[mate]!, y: Position.y[mate]!, vx: Velocity.x[mate]!, vy: Velocity.y[mate]!, facing: Facing[mate]! };
    const predicted = predictRun(body, offer, scene, 1, TIME_STEP);
    for (let time = 0; time < 1 - TIME_STEP / 2; time += TIME_STEP) step(world);
    expect(Math.hypot(predicted.x - Position.x[mate]!, predicted.y - Position.y[mate]!)).toBeLessThan(1);
  });

  test("moves the supporter out of a passing lane a defender is standing in", () => {
    const world = createGame();
    const { Position, Velocity, Grounded } = world.components;
    const [home, away] = [addTeam(world, UP_THE_PITCH), addTeam(world, DOWN_THE_PITCH)];
    const carrier = joinTeam(world, addPlayer(world, 59.7, GOAL_CENTRE), home);
    const mate = joinTeam(world, addPlayer(world, 60, GOAL_CENTRE + 10), home);
    const ball = addBall(world, 60, GOAL_CENTRE);
    const defender = joinTeam(world, addDefender(world, 60, GOAL_CENTRE + 5), away);
    addComponent(world, defender, Grounded);
    Grounded.recoversIn[defender] = 5;
    setDribble(world, carrier, 60.5, GOAL_CENTRE);
    setInPossession(world, home);
    const laneIsShut = () => {
      const from: [number, number, number] = [Position.x[ball]!, Position.y[ball]!, 0];
      const pass = leadPass(from, [Position.x[mate]!, Position.y[mate]!], [Velocity.x[mate]!, Velocity.y[mate]!]);
      const flight = pass && passFlight(from, pass, TIME_STEP);
      const attempt = flight && interceptionOf(flight, [Position.x[defender]!, Position.y[defender]!], TIME_STEP, Grounded.recoversIn[defender]!);
      return attempt !== null && attempt.shortfall <= 0;
    };
    expect(laneIsShut()).toBe(true);
    for (let time = 0; time < 1.5; time += TIME_STEP) step(world);
    expect(laneIsShut()).toBe(false);
  });
});

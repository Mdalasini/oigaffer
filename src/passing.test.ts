import { describe, expect, test } from "bun:test";
import { hasComponent, query } from "bitecs";
import { DEFENDER_REACTION_TIME, PASS_ARRIVAL_SPEED, PITCH_LENGTH, SUPPORT_WIDTH, TIME_STEP, TOP_SPEED, TOUCH_REACH } from "./constants";
import { ballFlight } from "./flight";
import { GOAL_CENTRE } from "./goal";
import { interceptionOf, leadPass, passFlight } from "./passing";
import type { Point } from "./shooting";
import { step } from "./systems";
import { addBall, addDefender, addGoalkeeper, addPlayer, createGame, setAttacking, setDribble, setPassing, setSupporting } from "./world";

describe("a pass along the ground", () => {
  test("is led to where a running teammate will be, and gets there at a speed they can take", () => {
    const from: Point = [60, GOAL_CENTRE, 0];
    const receiver: [number, number] = [60, GOAL_CENTRE + 12];
    const running: [number, number] = [5, 0];
    const pass = leadPass(from, receiver, running)!;
    let time = 0;
    for (const [at, moving] of ballFlight(from, pass.velocity, TIME_STEP)) {
      time += TIME_STEP;
      const runnerX = receiver[0] + running[0] * time;
      if (Math.hypot(at[0] - runnerX, at[1] - receiver[1]) < 0.2) {
        expect(Math.hypot(moving[0], moving[1])).toBeCloseTo(PASS_ARRIVAL_SPEED, 0);
        return;
      }
    }
    throw new Error("the pass never met the runner");
  });
});

function passAcross(defenderAt: [number, number] | null, receiverVelocity: [number, number] = [0, 0]) {
  const world = createGame();
  const { Position, Velocity, Attacking, Intercepted, Passed } = world.components;
  const passer = addPlayer(world, 59.7, GOAL_CENTRE);
  const receiver = addPlayer(world, 60, GOAL_CENTRE + 10);
  [Velocity.x[receiver], Velocity.y[receiver]] = receiverVelocity;
  const ball = addBall(world, 60, GOAL_CENTRE);
  const defender = defenderAt && addDefender(world, ...defenderAt);
  setSupporting(world, receiver);
  setPassing(world, passer, receiver);
  const defenderSteps: [number, number][] = [];
  let passedFrom: Point | null = null;
  let flight = null;
  let defenderWhenPassed: [number, number] | null = null;
  for (let time = 0; time < 5 && !hasComponent(world, receiver, Attacking) && !hasComponent(world, ball, Intercepted); time += TIME_STEP) {
    step(world);
    if (!passedFrom && hasComponent(world, ball, Passed)) {
      passedFrom = [Position.x[ball]! - Velocity.x[ball]! * TIME_STEP, Position.y[ball]! - Velocity.y[ball]! * TIME_STEP, 0];
      if (defender !== null) defenderWhenPassed = [Position.x[defender]!, Position.y[defender]!];
      flight = passFlight(passedFrom, { to: [world.components.Passed.x[ball]!, world.components.Passed.y[ball]!, 0], velocity: [Velocity.x[ball]!, Velocity.y[ball]!, 0] }, TIME_STEP);
    }
    if (defender !== null) defenderSteps.push([Position.x[defender]!, Position.y[defender]!]);
  }
  return {
    world,
    flight,
    defenderWhenPassed,
    received: hasComponent(world, receiver, Attacking),
    intercepted: hasComponent(world, ball, Intercepted),
    passerSupports: hasComponent(world, passer, world.components.Supporting) && !hasComponent(world, passer, Attacking),
    defenderSteps,
  };
}

describe("passing to a teammate", () => {
  test("they take it and become the one on the ball, and the passer goes in support", () => {
    const { received, passerSupports } = passAcross(null);
    expect(received).toBe(true);
    expect(passerSupports).toBe(true);
  });

  test("the first touch takes the pace off the ball", () => {
    const { world, received } = passAcross(null);
    expect(received).toBe(true);
    const { Position, Velocity, Attacking, Ball } = world.components;
    const receiver = query(world, [Attacking])[0]!;
    const ball = query(world, [Ball])[0]!;
    expect(Math.hypot(Velocity.x[ball]! - Velocity.x[receiver]!, Velocity.y[ball]! - Velocity.y[receiver]!)).toBeLessThan(1e-9);
    expect(Math.hypot(Position.x[ball]! - Position.x[receiver]!, Position.y[ball]! - Position.y[receiver]!)).toBeLessThanOrEqual(TOUCH_REACH);
  });

  test("a teammate still speeding up gets onto the line of the ball rather than running past it", () => {
    expect(passAcross(null, [2, 0]).received).toBe(true);
  });

  test("a defender standing in the way cuts it out", () => {
    const { received, intercepted } = passAcross([60, GOAL_CENTRE + 5]);
    expect(intercepted).toBe(true);
    expect(received).toBe(false);
  });

  test("a defender waits until they've reacted before going for it", () => {
    const { defenderSteps } = passAcross([66, GOAL_CENTRE + 5]);
    const stepsToReact = Math.ceil(DEFENDER_REACTION_TIME / TIME_STEP) - 1;
    const passStep = 1;
    for (const spot of defenderSteps.slice(passStep, passStep + stepsToReact)) expect(spot).toEqual(defenderSteps[0]!);
    expect(defenderSteps.at(-1)).not.toEqual(defenderSteps[0]!);
  });

  test("whether a defender can get to it is known before it's played", () => {
    let cutOut = 0;
    for (let x = 62; x <= 72; x += 2) {
      for (let y = GOAL_CENTRE + 1; y <= GOAL_CENTRE + 9; y += 2) {
        const { flight, defenderWhenPassed, intercepted } = passAcross([x, y]);
        const predicted = interceptionOf(flight!, defenderWhenPassed!, TIME_STEP);
        expect(predicted !== null && predicted.shortfall <= 0).toBe(intercepted);
        if (intercepted) cutOut++;
      }
    }
    expect(cutOut).toBeGreaterThan(0);
  });
});

function twoOnOne(attackerAt: [number, number], mateAt: [number, number], defenderAt: [number, number], seconds = 8) {
  const world = createGame();
  const { Position, Passed, Attacking, Supporting, Struck, Tackled, Grounded, Held, GoalLineCrossing, Blocked, Intercepted } = world.components;
  const attacker = addPlayer(world, attackerAt[0] - 0.3, attackerAt[1]);
  const mate = addPlayer(world, ...mateAt);
  const ball = addBall(world, ...attackerAt);
  const defender = addDefender(world, ...defenderAt);
  addGoalkeeper(world, PITCH_LENGTH, GOAL_CENTRE);
  setAttacking(world, attacker);
  setSupporting(world, mate);
  const events: string[] = [];
  const beyondTheLineWhenPassedTo: number[] = [];

  const over = () => [GoalLineCrossing, Held, Blocked, Intercepted].some((part) => hasComponent(world, ball, part)) || hasComponent(world, attacker, Tackled) || hasComponent(world, mate, Tackled);
  for (let time = 0; time < seconds && !over(); time += TIME_STEP) {
    const wasPassed = hasComponent(world, ball, Passed);
    const line = Math.max(Position.x[ball]!, Position.x[defender]!);
    const beyond = [attacker, mate].map((eid) => Position.x[eid]! - line);
    step(world);
    if (!wasPassed && hasComponent(world, ball, Passed)) {
      events.push("pass");
      const receiver = hasComponent(world, mate, world.components.Receiving) ? 0 : 1;
      beyondTheLineWhenPassedTo.push(beyond[1 - receiver]!);
    }
    if (hasComponent(world, ball, Struck) && events.at(-1) !== "shot") events.push("shot");
    if (hasComponent(world, defender, Grounded) && events.at(-1) !== "tackle") events.push("tackle");
  }
  return { events, beyondTheLineWhenPassedTo };
}

const PLAYING_THROUGH = 20_000;

describe("a two-on-one", () => {
  test("the teammate catches up with the ball and keeps up with it, out to the side", () => {
    const world = createGame();
    const { Position } = world.components;
    const carrier = addPlayer(world, 59.7, GOAL_CENTRE);
    const mate = addPlayer(world, 56, GOAL_CENTRE + 6);
    const ball = addBall(world, 60, GOAL_CENTRE);
    setDribble(world, carrier, PITCH_LENGTH, GOAL_CENTRE);
    setSupporting(world, mate);
    for (let time = 0; time < 4; time += TIME_STEP) step(world);
    expect(Math.abs(Position.x[mate]! - Position.x[ball]!)).toBeLessThan(2.5);
    expect(Math.abs(Math.abs(Position.y[mate]! - Position.y[ball]!) - SUPPORT_WIDTH)).toBeLessThan(1);
  });

  test("the teammate never aims to run beyond the last defender", () => {
    const world = createGame();
    const { Position, Target } = world.components;
    const carrier = addPlayer(world, 59.7, GOAL_CENTRE);
    const mate = addPlayer(world, 60, GOAL_CENTRE + 6);
    const ball = addBall(world, 60, GOAL_CENTRE);
    const defender = addDefender(world, 63, GOAL_CENTRE - 10);
    addGoalkeeper(world, PITCH_LENGTH, GOAL_CENTRE);
    setDribble(world, carrier, 75, GOAL_CENTRE - 30);
    setSupporting(world, mate);
    let furthestBeyond = -Infinity;
    for (let time = 0; time < 3; time += TIME_STEP) {
      step(world);
      furthestBeyond = Math.max(furthestBeyond, Target.x[mate]! - Math.max(Position.x[defender]!, Position.x[ball]!));
    }
    expect(furthestBeyond).toBeLessThan(TOP_SPEED * TIME_STEP);
  });

  test("with the defender closing in on the ball, they slip the teammate in rather than take the defender on", () => {
    const { events } = twoOnOne([PITCH_LENGTH - 22, GOAL_CENTRE - 2], [PITCH_LENGTH - 22, GOAL_CENTRE + 6], [PITCH_LENGTH - 19, GOAL_CENTRE - 2]);
    expect(events[0]).toBe("pass");
  });

  test("whoever is passed to is onside when the ball is played", () => {
    const starts: [[number, number], [number, number], [number, number]][] = [
      [[PITCH_LENGTH - 22, GOAL_CENTRE - 2], [PITCH_LENGTH - 22, GOAL_CENTRE + 6], [PITCH_LENGTH - 19, GOAL_CENTRE - 2]],
      [[PITCH_LENGTH - 30, GOAL_CENTRE], [PITCH_LENGTH - 28, GOAL_CENTRE + 8], [PITCH_LENGTH - 18, GOAL_CENTRE]],
      [[PITCH_LENGTH - 28, GOAL_CENTRE - 6], [PITCH_LENGTH - 28, GOAL_CENTRE + 4], [PITCH_LENGTH - 20, GOAL_CENTRE - 3]],
    ];
    const passes = starts.flatMap((start) => twoOnOne(...start).beyondTheLineWhenPassedTo);
    expect(passes.length).toBeGreaterThan(0);
    for (const beyond of passes) expect(beyond).toBeLessThanOrEqual(0.05);
  }, PLAYING_THROUGH);

  test("don't pass when the defender is standing in the way of it", () => {
    const { events } = twoOnOne([PITCH_LENGTH - 22, GOAL_CENTRE - 2], [PITCH_LENGTH - 22, GOAL_CENTRE + 6], [PITCH_LENGTH - 22, GOAL_CENTRE + 2], 1);
    expect(events).not.toContain("pass");
  });
});


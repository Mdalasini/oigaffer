import { describe, expect, test } from "bun:test";
import { addComponent, hasComponent, query } from "bitecs";
import { DEFENDER_REACTION_TIME, PASS_ARRIVAL_SPEED, PITCH_LENGTH, TIME_STEP, TOP_SPEED, TOUCH_REACH } from "./constants";
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

  test("is called off if a defender gets into its way before it's struck", () => {
    const world = createGame();
    const { Attacking, Passing, Passed, Ball } = world.components;
    const passer = addPlayer(world, 59.7, GOAL_CENTRE);
    const receiver = addPlayer(world, 60, GOAL_CENTRE + 10);
    addBall(world, 60, GOAL_CENTRE);
    addDefender(world, 60.3, GOAL_CENTRE + 1.5);
    setAttacking(world, passer);
    setSupporting(world, receiver);
    setPassing(world, passer, receiver);
    step(world);
    expect(hasComponent(world, passer, Passing)).toBe(false);
    expect(hasComponent(world, query(world, [Ball])[0]!, Passed)).toBe(false);
    expect(hasComponent(world, passer, Attacking)).toBe(true);
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

const PLAYING_SEVERAL_SECONDS_THROUGH = 30_000;

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
  const onTheBallBeforePassingBack: number[] = [];
  let receivedAt: number | null = null;

  const over = () => [GoalLineCrossing, Held, Blocked, Intercepted].some((part) => hasComponent(world, ball, part)) || hasComponent(world, attacker, Tackled) || hasComponent(world, mate, Tackled);
  for (let time = 0; time < seconds && !over(); time += TIME_STEP) {
    const wasPassed = hasComponent(world, ball, Passed);
    const line = Math.max(Position.x[ball]!, Position.x[defender]!);
    const beyond = [attacker, mate].map((eid) => Position.x[eid]! - line);
    step(world);
    if (wasPassed && !hasComponent(world, ball, Passed)) receivedAt = time;
    if (!wasPassed && hasComponent(world, ball, Passed)) {
      if (receivedAt !== null) onTheBallBeforePassingBack.push(time - receivedAt);
      events.push("pass");
      const receiver = hasComponent(world, mate, world.components.Receiving) ? 0 : 1;
      beyondTheLineWhenPassedTo.push(beyond[1 - receiver]!);
    }
    if (hasComponent(world, ball, Struck) && events.at(-1) !== "shot") events.push("shot");
    if (hasComponent(world, defender, Grounded) && events.at(-1) !== "tackle") events.push("tackle");
  }
  return { events, beyondTheLineWhenPassedTo, onTheBallBeforePassingBack };
}

describe("a two-on-one", () => {
  test("while the defender is still well ahead, the teammate heads level with or beyond the ball, on the side away from the defender", () => {
    const world = createGame();
    const { Position, Target } = world.components;
    const carrier = addPlayer(world, PITCH_LENGTH - 30.3, GOAL_CENTRE);
    const mate = addPlayer(world, PITCH_LENGTH - 36, GOAL_CENTRE + 1);
    const ball = addBall(world, PITCH_LENGTH - 30, GOAL_CENTRE);
    addDefender(world, PITCH_LENGTH - 16, GOAL_CENTRE - 3);
    addGoalkeeper(world, PITCH_LENGTH, GOAL_CENTRE);
    setDribble(world, carrier, PITCH_LENGTH, GOAL_CENTRE);
    setSupporting(world, mate);
    for (let time = 0; time < 1; time += TIME_STEP) {
      step(world);
      expect(Target.x[mate]!).toBeGreaterThanOrEqual(Position.x[ball]! - 0.5);
      expect(Target.y[mate]!).toBeGreaterThan(Position.y[ball]!);
    }
  });

  test("a teammate with the defender between them and the ball moves to open up a way to pass to them", () => {
    const world = createGame();
    const { Position, Velocity, Grounded } = world.components;
    const mate = addPlayer(world, PITCH_LENGTH - 25, GOAL_CENTRE + 10);
    const ball = addBall(world, PITCH_LENGTH - 25, GOAL_CENTRE);
    const defender = addDefender(world, PITCH_LENGTH - 25, GOAL_CENTRE + 5);
    addComponent(world, defender, Grounded);
    Grounded.recoversIn[defender] = Infinity;
    addGoalkeeper(world, PITCH_LENGTH, GOAL_CENTRE);
    setSupporting(world, mate);
    const isCutOut = () => {
      const from: Point = [Position.x[ball]!, Position.y[ball]!, 0];
      const pass = leadPass(from, [Position.x[mate]!, Position.y[mate]!], [Velocity.x[mate]!, Velocity.y[mate]!])!;
      const attempt = interceptionOf(passFlight(from, pass, TIME_STEP)!, [Position.x[defender]!, Position.y[defender]!], TIME_STEP);
      return attempt !== null && attempt.shortfall <= 0;
    };
    expect(isCutOut()).toBe(true);
    for (let time = 0; time < 2; time += TIME_STEP) step(world);
    expect(isCutOut()).toBe(false);
  });

  test("a pass is worth more to a teammate running at goal than to the same teammate standing still", () => {
    const worthOfPassingTo = (speed: number) => {
      const world = createGame();
      const { Velocity, Attacking } = world.components;
      const carrier = addPlayer(world, PITCH_LENGTH - 30.3, GOAL_CENTRE);
      addBall(world, PITCH_LENGTH - 30, GOAL_CENTRE);
      const mate = addPlayer(world, PITCH_LENGTH - 30, GOAL_CENTRE + 10);
      const towardsGoal = Math.atan2(-10, 30);
      [Velocity.x[mate], Velocity.y[mate]] = [Math.cos(towardsGoal) * speed, Math.sin(towardsGoal) * speed];
      addDefender(world, PITCH_LENGTH - 24, GOAL_CENTRE - 2);
      addGoalkeeper(world, PITCH_LENGTH, GOAL_CENTRE);
      setAttacking(world, carrier);
      setSupporting(world, mate);
      step(world);
      return Attacking.bestPass[carrier]!;
    };
    expect(worthOfPassingTo(TOP_SPEED)).toBeGreaterThan(worthOfPassingTo(0));
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
  }, PLAYING_SEVERAL_SECONDS_THROUGH);

  test("with the defender closing in on the ball, they slip the teammate in rather than take the defender on", () => {
    const { events } = twoOnOne([PITCH_LENGTH - 22, GOAL_CENTRE - 2], [PITCH_LENGTH - 22, GOAL_CENTRE + 6], [PITCH_LENGTH - 19, GOAL_CENTRE - 2]);
    expect(events[0]).toBe("pass");
  }, PLAYING_SEVERAL_SECONDS_THROUGH);

  const STARTS: [[number, number], [number, number], [number, number]][] = [
    [[PITCH_LENGTH - 22, GOAL_CENTRE - 2], [PITCH_LENGTH - 22, GOAL_CENTRE + 6], [PITCH_LENGTH - 19, GOAL_CENTRE - 2]],
    [[PITCH_LENGTH - 30, GOAL_CENTRE], [PITCH_LENGTH - 28, GOAL_CENTRE + 8], [PITCH_LENGTH - 18, GOAL_CENTRE]],
    [[PITCH_LENGTH - 28, GOAL_CENTRE - 6], [PITCH_LENGTH - 28, GOAL_CENTRE + 4], [PITCH_LENGTH - 20, GOAL_CENTRE - 3]],
  ];

  test("whoever is passed to is onside when the ball is played", () => {
    const passes = STARTS.flatMap((start) => twoOnOne(...start).beyondTheLineWhenPassedTo);
    expect(passes.length).toBeGreaterThan(0);
    for (const beyond of passes) expect(beyond).toBeLessThanOrEqual(0.05);
  }, PLAYING_SEVERAL_SECONDS_THROUGH);

  test("with the defender still ten metres off, carry the ball at them rather than pass back to a teammate behind", () => {
    const starts: [[number, number], [number, number], [number, number]][] = [
      [[PITCH_LENGTH - 33, GOAL_CENTRE - 3], [PITCH_LENGTH - 38, GOAL_CENTRE + 5], [PITCH_LENGTH - 23, GOAL_CENTRE - 1]],
      [[PITCH_LENGTH - 26, GOAL_CENTRE - 3], [PITCH_LENGTH - 31, GOAL_CENTRE - 9], [PITCH_LENGTH - 16, GOAL_CENTRE - 2]],
      [[PITCH_LENGTH - 29, GOAL_CENTRE + 5], [PITCH_LENGTH - 33, GOAL_CENTRE + 13], [PITCH_LENGTH - 18, GOAL_CENTRE + 3]],
    ];
    for (const start of starts) expect(twoOnOne(...start, 1).events).not.toContain("pass");
  }, PLAYING_SEVERAL_SECONDS_THROUGH);

  test("a teammate who has just been passed to doesn't knock it straight back", () => {
    const returns = STARTS.flatMap((start) => twoOnOne(...start).onTheBallBeforePassingBack);
    for (const seconds of returns) expect(seconds).toBeGreaterThan(1);
  }, PLAYING_SEVERAL_SECONDS_THROUGH);

  test("don't pass when the defender is standing in the way of it", () => {
    const { events } = twoOnOne([PITCH_LENGTH - 22, GOAL_CENTRE - 2], [PITCH_LENGTH - 22, GOAL_CENTRE + 6], [PITCH_LENGTH - 22, GOAL_CENTRE + 2], 1);
    expect(events).not.toContain("pass");
  });
});


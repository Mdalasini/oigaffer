import { describe, expect, test } from "bun:test";
import { fixedManager } from "../manager";
import { seededRng } from "../random";
import { strongVsWeak } from "../test-helpers";
import { BALL_SPEED, CONTROL_TICKS, HEADER_HEIGHT, MATCH_SECONDS } from "./constants";
import { advanceFlight, launchFlight, sampleFlight } from "./flight";
import { dist } from "./geometry";
import { createMatchState, stepEventMatch, tick } from "./match";
import { moveOffBall, pickUpLooseBall } from "./movement";
import { act, attemptTackle, resolveShot } from "./resolve";
import { giveBall, keeperOf, owner, type FlightKind, type MatchState } from "./state";

function setup() {
  const world = strongVsWeak(12, 12);
  const manager = fixedManager({ formation: "4-4-2", mentality: 0 });
  const state = createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(1), { home: manager, away: manager });
  for (const p of state.players) p.pos = p.side === "home" ? { x: 5, y: 5 } : { x: 104, y: 60 };
  const passer = state.players.find((p) => p.side === "home" && p.position === "MID")!;
  const receiver = state.players.find((p) => p.side === "home" && p.position === "FWD")!;
  passer.pos = { x: 40, y: 34 };
  receiver.pos = { x: 65, y: 34 };
  giveBall(state, passer, 0);
  return { state, passer, receiver };
}

function flightStep(state: MatchState) {
  state.time++;
  state.clock++;
  moveOffBall(state);
  advanceFlight(state);
}

function land(state: MatchState) {
  const arrival = state.ball.flight!.arrivalTick;
  while (state.time < arrival) flightStep(state);
}

describe("scheduled flight", () => {
  test("pass rolls at launch but possession, event and control delay start at arrival", () => {
    const { state, passer, receiver } = setup();
    let draws = 0;
    state.rng = () => { draws++; return 0.5; };
    act(state, passer, { kind: "pass", receiver, success: 1, risks: [] });
    expect(draws).toBe(1);
    expect(owner(state)).toBeUndefined();
    expect(state.ball.pos).toEqual(passer.pos);
    expect(state.events.some((e) => e.type === "pass")).toBe(false);
    const flight = state.ball.flight!;
    expect(flight.arrivalTick).toBe(2);
    state.time = 1;
    advanceFlight(state);
    expect(state.ball.pos).toEqual({ x: 52.5, y: 34 });
    expect(state.ball.height).toBe(0);
    expect(state.ball.ownerId).toBeNull();
    state.time = 2;
    advanceFlight(state);
    expect(draws).toBe(1); // applying the pass does not re-roll it
    expect(owner(state)).toBe(receiver);
    expect(state.ball.readyAt).toBe(2 + CONTROL_TICKS);
    expect(state.events.at(-1)).toMatchObject({ type: "pass", time: 2 });
    expect(state.ball.flight).toBeNull();
  });

  test("flight is immune to pickup and tackling even at zero height", () => {
    const { state, passer, receiver } = setup();
    act(state, passer, { kind: "pass", receiver, success: 1, risks: [] });
    const defender = state.players.find((p) => p.side === "away" && p.position === "DEF")!;
    defender.pos = { ...passer.pos };
    pickUpLooseBall(state);
    expect(attemptTackle(state, passer)).toBe(false);
    expect(state.ball.ownerId).toBeNull();
    expect(state.events.some((e) => e.type === "tackle" || e.type === "recovery")).toBe(false);
  });

  test("all flight kinds support fractional sampling, clamping and bounded speed", () => {
    for (const kind of Object.keys(BALL_SPEED) as FlightKind[]) {
      const { state } = setup();
      launchFlight(state, kind, { x: 100, y: 34 }, { type: "loose", side: "home", runnerId: null });
      const flight = state.ball.flight!;
      const middle = sampleFlight(flight, flight.arrivalTick / 2);
      expect(middle.pos).toEqual({ x: 70, y: 34 });
      expect(middle.height).toBe(flight.peakHeight);
      expect(sampleFlight(flight, -10).pos).toEqual(flight.origin);
      expect(sampleFlight(flight, 100).pos).toEqual(flight.destination);
      let previous = flight.origin;
      for (let t = 1; t <= flight.arrivalTick; t++) {
        const sample = sampleFlight(flight, t);
        expect(dist(previous, sample.pos)).toBeLessThanOrEqual(BALL_SPEED[kind]);
        previous = sample.pos;
      }
    }
  });

  test("receiver steers toward the fixed arrival point during flight", () => {
    const { state, passer, receiver } = setup();
    act(state, passer, { kind: "through", receiver, target: { x: 85, y: 34 }, success: 1, risks: [] });
    const landing = state.ball.flight!.destination;
    const before = dist(receiver.pos, landing);
    state.time++;
    tick(state);
    expect(dist(receiver.pos, landing)).toBeLessThan(before);
    expect(state.ball.ownerId).toBeNull();
    expect(state.ball.height).toBeGreaterThan(0);
  });

  test("interceptor runs to meet the launch-time interception point", () => {
    const { state, passer, receiver } = setup();
    const defender = state.players.find((p) => p.side === "away" && p.position === "DEF")!;
    defender.pos = { x: 55, y: 34 };
    act(state, passer, { kind: "pass", receiver, success: 0, risks: [{ player: defender, risk: 1 }] });
    expect(state.ball.flight!.destination).toEqual({ x: 55, y: 34 });
    defender.pos = { x: 60, y: 34 };
    land(state);
    expect(owner(state)).toBe(defender);
    expect(state.events.at(-1)?.type).toBe("interception");
  });

  test("an unreachable receiver leaves a loose ball instead of teleporting it", () => {
    const { state, passer, receiver } = setup();
    act(state, passer, { kind: "pass", receiver, success: 1, risks: [] });
    receiver.pos = { x: 5, y: 5 };
    state.time = state.ball.flight!.arrivalTick;
    advanceFlight(state);
    expect(state.ball.pos).toEqual({ x: 65, y: 34 });
    expect(state.ball.ownerId).toBeNull();
    expect(state.ball.runnerId).toBe(receiver.id);
    expect(state.events.some((e) => e.type === "pass" || e.type === "interception")).toBe(false);
  });

  test("an unreached interceptor is not credited with an interception", () => {
    const { state, passer, receiver } = setup();
    const defender = state.players.find((p) => p.side === "away" && p.position === "DEF")!;
    defender.pos = { x: 55, y: 34 };
    act(state, passer, { kind: "pass", receiver, success: 0, risks: [{ player: defender, risk: 1 }] });
    defender.pos = { x: 100, y: 60 };
    state.time = state.ball.flight!.arrivalTick;
    advanceFlight(state);
    expect(state.ball.ownerId).toBeNull();
    expect(state.ball.pos).toEqual({ x: 55, y: 34 });
    expect(state.ball.runnerId).toBe(defender.id);
    expect(state.events.some((e) => e.type === "interception")).toBe(false);
  });

  test("a parry is serialisable and launches a separate rebound flight", () => {
    const { state, passer } = setup();
    const rolls = [0.9, 0, 0.9, 0.9, 0.5, 0.5]; // miss scoring, on target, parry, back into play, scatter
    state.rng = () => rolls.shift() ?? 0.5;
    resolveShot(state, passer, 0, "penalty");
    expect(state.ball.flight!.arrival.type).toBe("follow_on");
    expect(JSON.parse(JSON.stringify(state.ball))).toEqual(state.ball);
    const destination = state.ball.flight!.destination;
    state.time = state.ball.flight!.arrivalTick;
    advanceFlight(state);
    expect(state.events.at(-1)).toMatchObject({ type: "shot", outcome: "saved", time: state.time });
    expect(state.ball.pos).toEqual(destination);
    expect(state.ball.flight!.kind).toBe("pass");
    expect(state.ball.flight!.launchTick).toBe(state.time);
    expect(state.ball.flight!.arrivalTick).toBeGreaterThan(state.time);
    expect(state.ball.ownerId).toBeNull();
    expect(JSON.parse(JSON.stringify(state.ball))).toEqual(state.ball);
    state.time = state.ball.flight!.arrivalTick;
    advanceFlight(state);
    expect(state.ball.flight).toBeNull();
    expect(state.ball.ownerId).toBeNull();
  });

  test("shot score, xG and restart are delayed until the shot reaches goal", () => {
    const { state, passer } = setup();
    resolveShot(state, passer, 1, "penalty");
    expect(state.score.home).toBe(0);
    expect(state.xg.home).toBe(0);
    expect(state.ball.flight!.kind).toBe("shot");
    expect(state.events.some((e) => e.type === "shot")).toBe(false);
    land(state);
    expect(state.score.home).toBe(1);
    expect(state.xg.home).toBe(1);
    expect(state.events.find((e) => e.type === "shot")).toMatchObject({ outcome: "goal", time: 3 });
    expect(state.ball.setPiece).toBe("kickoff");
  });

  test("cross contact launches a separate header flight, never an immediate goal", () => {
    const { state, passer, receiver } = setup();
    receiver.pos = { x: 95, y: 34 };
    giveBall(state, passer, 0, "corner");
    act(state, passer, { kind: "cross", target: receiver, delivery: 1, claim: 0, duel: 1, xg: 1, defender: null });
    const arrival = state.ball.flight!.arrivalTick;
    let draws = 0;
    state.rng = () => { draws++; return 0.1; };
    expect(state.events.some((e) => e.type === "cross" || e.type === "shot")).toBe(false);
    state.time = arrival - 1;
    advanceFlight(state);
    expect(draws).toBe(0);
    state.time = arrival;
    advanceFlight(state);
    expect(draws).toBe(2); // on-target and scoring rolls happen at header contact
    expect(state.time).toBe(arrival);
    expect(state.events.at(-1)).toMatchObject({ type: "cross", outcome: "won" });
    expect(state.ball.flight!.kind).toBe("shot");
    expect(state.ball.flight!.launchHeight).toBe(HEADER_HEIGHT);
    expect(state.events.some((e) => e.type === "shot")).toBe(false);
    land(state);
    expect(state.events.at(-2)?.type === "shot" || state.events.at(-1)?.type === "shot").toBe(true);
  });

  test("a claimed cross makes the keeper move to the cross landing spot", () => {
    const { state, passer, receiver } = setup();
    receiver.pos = { x: 95, y: 34 };
    const keeper = keeperOf(state, "away")!;
    keeper.pos = { x: 103, y: 34 };
    giveBall(state, passer, 0, "corner");
    act(state, passer, { kind: "cross", target: receiver, delivery: 1, claim: 1, duel: 1, xg: 1, defender: null });
    expect(state.ball.flight!.meetIds).toEqual([keeper.id]);
    land(state);
    expect(keeper.pos).toEqual({ x: 95, y: 34 });
    expect(owner(state)).toBe(keeper);
  });

  test("clearance is lofted and not emitted until landing", () => {
    const { state, passer } = setup();
    act(state, passer, { kind: "clear", distance: 40 });
    expect(state.ball.flight!.kind).toBe("clearance");
    expect(state.events.some((e) => e.type === "clearance")).toBe(false);
    flightStep(state);
    expect(state.ball.height).toBeGreaterThan(1);
    land(state);
    expect(state.events.some((e) => e.type === "clearance")).toBe(true);
    expect(state.ball.height).toBe(0);
  });

  test("late penalty keeps the period alive until its scheduled arrival", () => {
    const { state, passer } = setup();
    state.period = 2;
    state.phase = "second_half";
    state.clock = MATCH_SECONDS;
    state.periodEnd = MATCH_SECONDS;
    state.announcedEnd = MATCH_SECONDS;
    giveBall(state, passer, 0, "penalty");
    resolveShot(state, passer, 1, "penalty");
    while (state.ball.flight) {
      stepEventMatch(state);
      expect(state.phase).toBe("second_half");
    }
    expect(state.score.home).toBe(1);
    stepEventMatch(state);
    expect(state).toMatchObject({ phase: "full_time" });
  });

  test("ball and arrival data survive JSON round-tripping mid-flight without functions", () => {
    const { state, passer, receiver } = setup();
    act(state, passer, { kind: "pass", receiver, success: 1, risks: [] });
    flightStep(state);
    const assertData = (value: unknown): void => {
      expect(typeof value).not.toBe("function");
      if (value && typeof value === "object") for (const child of Object.values(value)) assertData(child);
    };
    assertData(state.ball);
    const restored = JSON.parse(JSON.stringify(state.ball));
    expect(restored).toEqual(state.ball);
    state.ball = restored;
    land(state);
    expect(owner(state)).toBe(receiver);
    expect(state.events.at(-1)).toMatchObject({ type: "pass", time: 2 });

    giveBall(state, passer, 0);
    state.rng = () => 0.9;
    resolveShot(state, passer, 0, "penalty");
    assertData(state.ball);
    expect(JSON.parse(JSON.stringify(state.ball))).toEqual(state.ball);
  });

  test("blocked shots and crosses fly to the nearest goal-line point before a corner", () => {
    for (const kind of ["shot", "cross"] as const) {
      const { state, passer, receiver } = setup();
      passer.pos = { x: 90, y: 10 };
      const defender = state.players.find((p) => p.side === "away" && p.position === "DEF")!;
      defender.pos = kind === "cross" ? { ...passer.pos } : { x: 95, y: 18 };
      giveBall(state, passer, 0);
      state.rng = () => 0;
      if (kind === "shot") resolveShot(state, passer, 0.1, "open_play");
      else act(state, passer, { kind: "cross", target: receiver, delivery: 1, claim: 0, duel: 1, xg: 1, defender });
      expect(state.ball.flight!.destination).toEqual({ x: 105, y: 10 });
      expect(state.ball.setPiece).toBeNull();
      land(state);
      expect(state.ball.setPiece).toBe("corner");
      expect(state.ball.pos).toEqual({ x: 105, y: 0 });
    }
  });

  test("the period whistle discards a pending non-penalty flight", () => {
    const { state, passer, receiver } = setup();
    act(state, passer, { kind: "pass", receiver, success: 1, risks: [] });
    state.clock = state.periodEnd = state.announcedEnd = MATCH_SECONDS;
    state.period = 2;
    state.phase = "second_half";
    stepEventMatch(state);
    expect(state).toMatchObject({ phase: "full_time" });
    expect(state.ball.flight).toBeNull();
    expect(state.ball.height).toBe(0);
    expect(state.events.some((e) => e.type === "pass")).toBe(false);
  });

  test("a new restart/possession cancels any pending flight outcome", () => {
    const { state, passer, receiver } = setup();
    act(state, passer, { kind: "pass", receiver, success: 1, risks: [] });
    giveBall(state, passer, 0, "kickoff");
    expect(state.ball.flight).toBeNull();
    state.time = 100;
    advanceFlight(state);
    expect(owner(state)).toBe(passer);
    expect(state.events.some((e) => e.type === "pass")).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { seededRng } from "../random";
import { strongVsWeak } from "../test-helpers";
import { CARRIER_JOG_SPEED, CONTROL_MIN_TICKS, CONTROL_TICKS, DECISION_PAUSE_TICKS, FIRST_TOUCH_SPEED, KEEPER_HOLD_TICKS } from "./constants";
import { advanceFlight, launchFlight } from "./flight";
import { dist } from "./geometry";
import { createMatchState } from "./match";
import { moveCarrier, moveOffBall } from "./movement";
import { goalKick } from "./restarts";
import { fromTeamFrame, giveBall, owner, type Side } from "./state";

function situation(side: Side = "home") {
  const world = strongVsWeak(12, 12);
  const state = createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(1));
  for (const p of state.players) p.pos = { x: 1, y: 1 };
  const receiver = state.players.find(p => p.side === side && p.position === "MID")!;
  receiver.pos = fromTeamFrame(side, { x: 50, y: 34 });
  const defender = state.players.find(p => p.side !== side && p.position === "DEF")!;
  defender.pos = fromTeamFrame(side, { x: 90, y: 34 });
  return { state, receiver, defender };
}

describe("moving first touch with ball flight", () => {
  test("a landed reception uses current skill and pressure, not launch-time control", () => {
    const { state, receiver, defender } = situation();
    launchFlight(state, "pass", receiver.pos, { type: "receive", playerId: receiver.id }, [receiver.id]);
    receiver.attributes.passing = receiver.attributes.dribbling = 20;
    state.time = state.ball.flight!.arrivalTick;
    advanceFlight(state);
    expect(owner(state)).toBe(receiver);
    expect(state.ball.controlledAt - state.time).toBe(CONTROL_MIN_TICKS);
    expect(state.ball.readyAt - state.ball.controlledAt).toBe(DECISION_PAUSE_TICKS);
    receiver.attributes.passing = receiver.attributes.dribbling = 1;
    defender.pos = { ...receiver.pos };
    giveBall(state, receiver);
    expect(state.ball.controlledAt - state.time).toBe(CONTROL_TICKS);
    giveBall(state, receiver, 7);
    expect(state.ball.controlledAt - state.time).toBe(7);
    expect(state.ball.pendingTouch).toBe(false);
  });

  test("receivers move with the ball through control and look-up in both frames", () => {
    for (const side of ["home", "away"] as const) {
      const { state, receiver } = situation(side);
      giveBall(state, receiver);
      const readyAt = state.ball.readyAt;
      for (; state.time < readyAt; state.time++) {
        const from = { ...receiver.pos };
        const energy = receiver.energy;
        const speed = state.time < state.ball.controlledAt ? FIRST_TOUCH_SPEED : CARRIER_JOG_SPEED;
        moveCarrier(state, receiver);
        expect(dist(from, receiver.pos)).toBeGreaterThan(0);
        expect(dist(from, receiver.pos)).toBeLessThanOrEqual(speed + 1e-9);
        expect(receiver.energy).toBeLessThan(energy);
        expect(state.ball.pos).toEqual(receiver.pos);
        expect(owner(state)).toBe(receiver);
      }
    }
  });

  test("the receiving touch escapes a nearby opponent", () => {
    const { state, receiver, defender } = situation();
    defender.pos = { x: receiver.pos.x, y: receiver.pos.y + 1 };
    state.rng = () => 1;
    giveBall(state, receiver);
    const from = { ...receiver.pos };
    moveCarrier(state, receiver);
    expect(receiver.pos.x).toBeGreaterThan(from.x);
    expect(receiver.pos.y).toBeLessThan(from.y);
    expect(dist(receiver.pos, defender.pos)).toBeGreaterThan(dist(from, defender.pos));
  });

  test("heavy touch needs pressure and is rolled once per reception", () => {
    const { state, receiver, defender } = situation();
    receiver.attributes.passing = receiver.attributes.dribbling = 1;
    state.rng = () => 0;
    giveBall(state, receiver);
    moveCarrier(state, receiver);
    expect(owner(state)).toBe(receiver);
    defender.pos = { ...receiver.pos };
    giveBall(state, receiver);
    moveCarrier(state, receiver);
    expect(state.ball.ownerId).toBeNull();
    expect(state.ball.pendingTouch).toBe(false);
    giveBall(state, receiver);
    let rolls = 0;
    state.rng = () => { rolls++; return 1; };
    moveCarrier(state, receiver);
    moveCarrier(state, receiver);
    expect(rolls).toBe(1);
  });

  test("a heavy touch can run out through the ordinary throw-in rules", () => {
    const { state, receiver, defender } = situation();
    receiver.pos = { x: 50, y: 0.1 };
    defender.pos = { x: 50, y: 1 };
    receiver.attributes.passing = receiver.attributes.dribbling = 1;
    state.rng = () => 0;
    giveBall(state, receiver);
    moveCarrier(state, receiver);
    expect(state.ball.setPiece).toBe("throw_in");
    expect(owner(state)!.side).toBe("away");
    expect(state.ball.pos.y).toBe(0);
  });

  test("explicit dribble timing gets neither a reception carry nor an extra pause", () => {
    const { state, receiver } = situation();
    giveBall(state, receiver, 1);
    const from = { ...receiver.pos };
    moveCarrier(state, receiver);
    expect(receiver.pos).toEqual(from);
    expect(state.ball.readyAt - state.time).toBe(1);
    expect(state.ball.receiving).toBe(false);
  });

  test("off-ball targets see possession moved before either side's array block", () => {
    const a = situation("away");
    const b = situation("away");
    // Unique positions avoid making this a test of equal-distance tie breaking.
    for (const s of [a, b]) {
      s.state.players.forEach((p, i) => { if (p !== s.receiver) p.pos = { x: 5 + i * 3, y: 5 + i }; });
      s.state.rng = () => 1;
      giveBall(s.state, s.receiver);
    }
    b.state.players = [...b.state.players.filter(p => p.side === "away"), ...b.state.players.filter(p => p.side === "home")];
    moveOffBall(a.state);
    moveOffBall(b.state);
    for (const p of a.state.players) expect(b.state.players.find(q => q.id === p.id)!.pos).toEqual(p.pos);
    expect(a.state.ball.pos).toEqual(b.state.ball.pos);
  });

  test("restarts stay on their spot and keepers keep their hold time", () => {
    const { state } = situation();
    goalKick(state, "home");
    const spot = { ...state.ball.pos };
    moveOffBall(state);
    expect(state.ball.pos).toEqual(spot);
    const keeper = owner(state)!;
    // A stationary keeper holds it; a running claimant now brakes rather than snapping to a stop.
    keeper.vel = { x: 0, y: 0 };
    giveBall(state, keeper);
    const from = { ...keeper.pos };
    moveCarrier(state, keeper);
    expect(keeper.pos).toEqual(from);
    expect(state.ball.readyAt - state.time).toBe(KEEPER_HOLD_TICKS);
    expect(state.ball.pendingTouch).toBe(false);
  });
});

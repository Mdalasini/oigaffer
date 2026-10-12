import { describe, expect, test } from "bun:test";
import { fixedManager } from "../manager";
import { seededRng } from "../random";
import { player, strongVsWeak } from "../test-helpers";
import { STEER_ACCEL, STEER_BRAKE, STEER_JOG_TURN, STEER_MAX_SPEED, STEER_SPRINT_TURN } from "./constants";
import { tire } from "./fatigue";
import { kickoff } from "./formation";
import { dist } from "./geometry";
import { bench, substitute } from "./lineup";
import { createMatchState, tick } from "./match";
import { moveCarrier } from "./movement";
import { giveBall } from "./state";
import { act } from "./resolve";
import { movementBuffer, separateBodies, separation, steerPlayer, turnFacing } from "./steering";

function setup() {
  const world = strongVsWeak(12, 12);
  const reserve = player("reserve", "DEF", 6, 6);
  world.players[reserve.id] = reserve;
  world.clubs.strong!.playerIds.push(reserve.id);
  const manager = fixedManager({ formation: "4-4-2", mentality: 0 });
  return createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(41), { home: manager, away: manager });
}

const magnitude = (x: number, y: number) => Math.sqrt(x * x + y * y);

describe("player steering", () => {
  test("bounded acceleration and speed, including a sudden reversal", () => {
    const state = setup(), p = state.players[1]!;
    p.pos = { x: 20, y: 34 };
    const target = { x: 100, y: 34 };
    for (let i = 0; i < 8; i++) {
      const before = { ...p.vel };
      if (i === 4) target.x = 0;
      steerPlayer(p, target, STEER_MAX_SPEED, 0, state.ball.pos);
      expect(magnitude(p.vel.x - before.x, p.vel.y - before.y)).toBeLessThanOrEqual(Math.max(STEER_ACCEL, STEER_BRAKE) + 1e-9);
      expect(magnitude(p.vel.x, p.vel.y)).toBeLessThanOrEqual(STEER_MAX_SPEED);
      if (i === 0) expect(p.vel.x).toBeCloseTo(STEER_ACCEL);
    }
  });

  test("braking is gradual even when the requested speed drops to zero", () => {
    const state = setup(), p = state.players[1]!;
    p.pos = { x: 20, y: 34 }; p.vel = { x: 8, y: 0 };
    steerPlayer(p, p.pos, 0, 0, state.ball.pos);
    expect(p.vel.x).toBeCloseTo(8 - STEER_BRAKE);
    expect(p.pos.x).toBeGreaterThan(20);
    steerPlayer(p, p.pos, 0, 0, state.ball.pos);
    expect(p.vel.x).toBe(0);
  });

  test("arrival settles without alternating backwards and forwards", () => {
    const state = setup(), p = state.players[1]!;
    p.pos = { x: 20, y: 34 };
    const target = { x: 23, y: 34 };
    let previous = p.pos.x;
    for (let i = 0; i < 30; i++) {
      steerPlayer(p, target, 6, 0, state.ball.pos);
      expect(p.pos.x).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(p.pos.x).toBeLessThanOrEqual(target.x + 1e-9);
      previous = p.pos.x;
    }
    expect(dist(p.pos, target)).toBeLessThan(0.001);
  });

  test("facing takes the shortest bounded turn and watches the ball at rest", () => {
    const state = setup(), p = state.players[1]!;
    p.pos = { x: 30, y: 34 }; p.facing = 0;
    p.vel = { x: -STEER_MAX_SPEED, y: 0 };
    turnFacing(p, state.ball.pos, 0.1);
    expect(Math.abs(p.facing)).toBeCloseTo(STEER_SPRINT_TURN * 0.1);
    p.vel = { x: 0, y: 0 }; p.facing = 0;
    turnFacing(p, { x: 0, y: 34 }, 0.1);
    expect(Math.abs(p.facing)).toBeCloseTo(STEER_JOG_TURN * 0.1);
    p.facing = Math.PI - 0.01;
    turnFacing(p, { x: 0, y: 33 }, 0.01);
    expect(Math.abs(p.facing)).toBeGreaterThan(3);
  });

  test("coincident bodies separate deterministically and do not jitter at rest", () => {
    const state = setup(); state.players = state.players.slice(0, 2);
    const [p, q] = state.players;
    p!.pos = { x: 30, y: 30 }; q!.pos = { x: 30, y: 30 };
    const buffer = movementBuffer(state);
    separation(state, buffer);
    expect(buffer.separation[0]).toBeCloseTo(-buffer.separation[2]!);
    expect(buffer.separation[1]).toBeCloseTo(-buffer.separation[3]!);
    separateBodies(state);
    expect(dist(p!.pos, q!.pos)).toBeGreaterThanOrEqual(1 - 1e-9);
    const before = { ...p!.pos };
    for (let i = 0; i < 20; i++) separateBodies(state);
    expect(dist(p!.pos, before)).toBeLessThan(1e-9);
  });

  test("fatigue follows distance travelled rather than requested speed", () => {
    const state = setup(), p = state.players[1]!;
    p.pos = { x: 20, y: 34 };
    const expected = { ...p };
    steerPlayer(p, { x: 100, y: 34 }, 8, 0, state.ball.pos);
    tire(expected, p.pos.x - 20);
    expect(p.energy).toBeCloseTo(expected.energy, 12);
  });

  test("a keeper who claims while running brakes during the hold", () => {
    const state = setup(), p = state.players.find(p => p.position === "GK")!;
    p.pos = { x: 20, y: 34 }; p.vel = { x: 8, y: 0 };
    giveBall(state, p);
    const readyAt = state.ball.readyAt;
    moveCarrier(state, p);
    expect(p.vel.x).toBeCloseTo(8 - STEER_BRAKE);
    expect(state.ball.pos).toEqual(p.pos);
    expect(state.ball.readyAt).toBe(readyAt);
  });

  test("a successful take-on queues plain movement data rather than teleporting", () => {
    const state = setup(), p = state.players.find(p => p.position === "MID")!;
    p.pos = { x: 20, y: 34 };
    giveBall(state, p, 0);
    act(state, p, { kind: "dribble", to: { x: 26, y: 34 }, defender: null, beat: 1 });
    expect(p.pos).toEqual({ x: 20, y: 34 });
    expect(p.carryTarget).toEqual({ x: 26, y: 34 });
    moveCarrier(state, p);
    expect(p.pos.x).toBeGreaterThan(20);
    expect(p.pos.x).toBeLessThanOrEqual(26);
    expect(p.carryTarget).toBeUndefined();
    expect(state.ball.pos).toEqual(p.pos);
  });

  test("starters, substitutes and half-start placements initialise motion", () => {
    const state = setup();
    for (const p of state.players) {
      expect(p.vel).toEqual({ x: 0, y: 0 });
      expect(p.facing).toBe(p.side === "home" ? 0 : Math.PI);
    }
    const outgoing = state.players[1]!, incoming = bench(state, outgoing.side)[0]!;
    expect(substitute(state, outgoing.side, outgoing.id, incoming.id)).toBe(true);
    const replacement = state.players.find(p => p.id === incoming.id)!;
    expect(replacement.vel).toEqual({ x: 0, y: 0 });
    expect(replacement.facing).toBe(Math.PI / 2);
    replacement.vel.x = 7; replacement.carryTarget = { x: 60, y: 20 };
    kickoff(state, "home", 0, true);
    expect(replacement.vel).toEqual({ x: 0, y: 0 });
    expect(replacement.carryTarget).toBeUndefined();
  });

  test("motion remains finite plain JSON data through live play", () => {
    const state = setup(); kickoff(state, "home", 0, true);
    for (let i = 0; i < 100; i++) {
      state.time++; state.clock++; tick(state);
      const players = JSON.parse(JSON.stringify(state)).players;
      expect(players).toEqual(state.players);
      for (const p of state.players) {
        for (const n of [p.pos.x, p.pos.y, p.vel.x, p.vel.y, p.facing]) expect(Number.isFinite(n)).toBe(true);
      }
    }
  });
});

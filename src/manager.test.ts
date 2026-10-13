import { describe, expect, test } from "bun:test";
import { defaultManager, type ManagerContext } from "./manager";

const even = { attack: 12, defence: 12 };
const ctx = (overrides: Partial<ManagerContext>): ManagerContext => ({
  minute: 10,
  goalsFor: 0,
  goalsAgainst: 0,
  strength: even,
  opponentStrength: even,
  tactics: { formation: "4-4-2", mentality: 0 },
  onPitch: [],
  bench: [],
  subsLeft: 5,
  ...overrides,
});

test("picks a starting setup from the strength gap", () => {
  const strong = { attack: 16, defence: 16 };
  const weak = { attack: 9, defence: 9 };
  expect(defaultManager.prematch({ strength: even, opponentStrength: even })).toEqual({ formation: "4-4-2", mentality: 0 });
  expect(defaultManager.prematch({ strength: strong, opponentStrength: weak })).toEqual({ formation: "4-3-3", mentality: 1 });
  expect(defaultManager.prematch({ strength: weak, opponentStrength: strong })).toEqual({ formation: "4-5-1", mentality: -1 });
});

test("keeps the starting setup early in a level game", () => {
  expect(defaultManager.inMatch(ctx({ minute: 30 }))).toEqual({ formation: "4-4-2", mentality: 0 });
});

test("chases the game when behind, harder the later it gets", () => {
  expect(defaultManager.inMatch(ctx({ minute: 30, goalsAgainst: 1 })).mentality).toBe(0);
  expect(defaultManager.inMatch(ctx({ minute: 30, goalsAgainst: 2 }))).toEqual({ formation: "4-3-3", mentality: 1 });
  expect(defaultManager.inMatch(ctx({ minute: 62, goalsAgainst: 1 }))).toEqual({ formation: "4-3-3", mentality: 1 });
  expect(defaultManager.inMatch(ctx({ minute: 78, goalsAgainst: 1 }))).toEqual({ formation: "3-4-3", mentality: 2 });
});

test("protects a lead late on", () => {
  expect(defaultManager.inMatch(ctx({ minute: 50, goalsFor: 1 })).mentality).toBe(0);
  expect(defaultManager.inMatch(ctx({ minute: 72, goalsFor: 1 }))).toEqual({ formation: "5-3-2", mentality: -1 });
  expect(defaultManager.inMatch(ctx({ minute: 85, goalsFor: 1 }))).toEqual({ formation: "5-4-1", mentality: -2 });
});

test("late in a level game the favourite pushes and the underdog settles", () => {
  const strong = { attack: 16, defence: 16 };
  expect(defaultManager.inMatch(ctx({ minute: 75, strength: strong })).mentality).toBe(1);
  expect(defaultManager.inMatch(ctx({ minute: 75, opponentStrength: strong })).mentality).toBe(-1);
});

describe("substitutions", () => {
  const attrs = (v: number) => ({ passing: v, shooting: v, dribbling: v, tackling: v, goalkeeping: v, stamina: v, pace: v, acceleration: v, jumping: v, strength: v, agility: v, balance: v });
  const onPitch = (id: string, role: "GK" | "DEF" | "MID" | "FWD", energy: number, natural = role) => ({
    id,
    role,
    natural,
    attributes: attrs(12),
    energy,
    yellow: false,
  });
  const benchMid = { id: "sub-mid", natural: "MID" as const, attributes: attrs(11) };
  const benchKeeper = { id: "sub-gk", natural: "GK" as const, attributes: attrs(11) };

  test("replaces the most tired outfield player in the second half", () => {
    const squad = [onPitch("gk", "GK", 0.5), onPitch("m1", "MID", 0.78), onPitch("m2", "MID", 0.7)];
    const subs = defaultManager.substitutions!(ctx({ minute: 65, onPitch: squad, bench: [benchMid] }));
    expect(subs).toEqual([{ offId: "m2", onId: "sub-mid" }]);
  });

  test("leaves tired players on in the first hour", () => {
    const subs = defaultManager.substitutions!(ctx({ minute: 40, onPitch: [onPitch("m", "MID", 0.6)], bench: [benchMid] }));
    expect(subs).toEqual([]);
  });

  test("gets a real keeper back in goal after a red card", () => {
    const squad = [onPitch("standin", "GK", 0.9, "DEF"), onPitch("m", "MID", 0.95)];
    const subs = defaultManager.substitutions!(ctx({ minute: 20, onPitch: squad, bench: [benchMid, benchKeeper] }));
    expect(subs).toEqual([{ offId: "standin", onId: "sub-gk" }]);
  });

  test("makes no changes with none left", () => {
    const squad = [onPitch("m", "MID", 0.5)];
    expect(defaultManager.substitutions!(ctx({ minute: 80, onPitch: squad, bench: [benchMid], subsLeft: 0 }))).toEqual([]);
  });
});

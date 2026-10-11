import { expect, test } from "bun:test";
import { defaultManager, type ManagerContext } from "./manager";

const even = { attack: 12, defence: 12 };
const ctx = (overrides: Partial<ManagerContext>): ManagerContext => ({
  minute: 10,
  goalsFor: 0,
  goalsAgainst: 0,
  strength: even,
  opponentStrength: even,
  tactics: { formation: "4-4-2", mentality: 0 },
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

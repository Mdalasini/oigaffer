import { FATIGUE_EFFECT } from "./engine/constants";
import type { Attributes, Id, Position } from "./model";
import { lineRating } from "./squad";
import type { ClubStrength } from "./strength";
import type { FormationName, Mentality, Tactics } from "./tactics";

export interface OnPitchView {
  id: Id;
  role: Position;
  natural: Position;
  attributes: Attributes; // fresh
  energy: number; // 1 fresh … 0 exhausted
  yellow: boolean;
}

export interface BenchView {
  id: Id;
  natural: Position;
  attributes: Attributes;
}

export interface ManagerContext {
  minute: number;
  goalsFor: number;
  goalsAgainst: number;
  strength: ClubStrength;
  opponentStrength: ClubStrength;
  tactics: Tactics; // what the team is currently playing
  onPitch: OnPitchView[];
  bench: BenchView[];
  subsLeft: number;
}

export interface Substitution {
  offId: Id;
  onId: Id;
}

type PrematchContext = Pick<ManagerContext, "strength" | "opponentStrength">;

// The strategy layer above the players. A human manager can implement the same interface.
export interface Manager {
  // Starting tactics, picked before kickoff
  prematch(ctx: PrematchContext): Tactics;
  // Called during the match; return the tactics to play from now on
  inMatch(ctx: ManagerContext): Tactics;
  // Changes to make at the next stoppage
  substitutions?(ctx: ManagerContext): Substitution[];
}

const tactics = (formation: FormationName, mentality: Mentality): Tactics => ({ formation, mentality });

// How much better we are, in the 1–20 attribute scale
const edge = (ctx: PrematchContext) =>
  ctx.strength.attack + ctx.strength.defence - ctx.opponentStrength.attack - ctx.opponentStrength.defence;

// Clear favourites go for it, clear underdogs sit in, everyone else plays it straight
function baseline(ctx: PrematchContext): Tactics {
  const e = edge(ctx);
  if (e > 3) return tactics("4-3-3", 1);
  if (e < -3) return tactics("4-5-1", -1);
  return tactics("4-4-2", 0);
}

// When to start freshening things up, and how tired someone has to be
const SUB_FROM_MINUTE = 58;
const TIRED = 0.8;
// Rating points a manager will give up to get a fresh player on
const FRESH_LEGS = 2;
// Keep one change back for an injury until late on
const SPARE_UNTIL_MINUTE = 85;

// Best bench player for a role; natural players for it get the nod
function bestFor(bench: BenchView[], role: Position): BenchView | undefined {
  const score = (b: BenchView) => lineRating(b.attributes, role) + (b.natural === role ? 3 : 0);
  return bench.reduce<BenchView | undefined>((a, b) => (!a || score(b) > score(a) ? b : a), undefined);
}

// A decision tree on the game state: chase the game when behind,
// protect a lead when ahead, and let the favourite push for a late winner.
// Subs: get a keeper back in goal after a red card, then replace tired legs one at a time.
export const defaultManager: Manager = {
  prematch: baseline,

  inMatch(ctx) {
    const { minute } = ctx;
    const diff = ctx.goalsFor - ctx.goalsAgainst;

    if (diff < 0) {
      if (minute >= 75) return tactics("3-4-3", 2);
      if (minute >= 60 || diff <= -2) return tactics("4-3-3", 1);
    } else if (diff > 0) {
      if (minute >= 80) return tactics("5-4-1", -2);
      if (minute >= 70 || (diff >= 2 && minute >= 60)) return tactics("5-3-2", -1);
    } else if (minute >= 70) {
      return edge(ctx) > 0 ? tactics("4-3-3", 1) : tactics("4-5-1", -1);
    }
    return baseline(ctx);
  },

  substitutions(ctx) {
    if (ctx.subsLeft === 0 || ctx.bench.length === 0) return [];

    const standIn = ctx.onPitch.find((p) => p.role === "GK" && p.natural !== "GK");
    const keeper = ctx.bench.find((b) => b.natural === "GK");
    if (standIn && keeper) return [{ offId: standIn.id, onId: keeper.id }];

    const spare = ctx.minute < SPARE_UNTIL_MINUTE ? 1 : 0;
    if (ctx.minute < SUB_FROM_MINUTE || ctx.subsLeft <= spare) return [];
    const tired = ctx.onPitch
      .filter((p) => p.role !== "GK" && p.energy < TIRED)
      .sort((a, b) => a.energy - b.energy)[0];
    if (!tired) return [];
    const replacement = bestFor(
      ctx.bench.filter((b) => b.natural !== "GK"),
      tired.role,
    );
    if (!replacement) return [];
    // Fresh legs are worth a little quality, but not a lot
    const tiredNow = lineRating(tired.attributes, tired.role) * (1 - FATIGUE_EFFECT * (1 - tired.energy));
    const worthIt = lineRating(replacement.attributes, tired.role) >= tiredNow - FRESH_LEGS;
    return worthIt ? [{ offId: tired.id, onId: replacement.id }] : [];
  },
};

// Never changes anything; handy for tests and for comparing styles
export function fixedManager(fixed: Tactics): Manager {
  return { prematch: () => fixed, inMatch: () => fixed };
}

// The player's manager: starts with their chosen tactics and never changes them
// itself. The UI applies the player's changes straight to the match instead.
export function humanManager(initial: Tactics): Manager {
  return { prematch: () => initial, inMatch: (ctx) => ctx.tactics };
}

import type { ClubStrength } from "./strength";
import type { FormationName, Mentality, Tactics } from "./tactics";

export interface ManagerContext {
  minute: number;
  goalsFor: number;
  goalsAgainst: number;
  strength: ClubStrength;
  opponentStrength: ClubStrength;
  tactics: Tactics; // what the team is currently playing
}

// The strategy layer above the players. A human manager can implement the same interface.
export interface Manager {
  // Starting tactics, picked before kickoff
  prematch(ctx: Pick<ManagerContext, "strength" | "opponentStrength">): Tactics;
  // Called during the match; return the tactics to play from now on
  inMatch(ctx: ManagerContext): Tactics;
}

const tactics = (formation: FormationName, mentality: Mentality): Tactics => ({ formation, mentality });

// How much better we are, in the 1–20 attribute scale
const edge = (ctx: Pick<ManagerContext, "strength" | "opponentStrength">) =>
  ctx.strength.attack + ctx.strength.defence - ctx.opponentStrength.attack - ctx.opponentStrength.defence;

// Clear favourites go for it, clear underdogs sit in, everyone else plays it straight
function baseline(ctx: Pick<ManagerContext, "strength" | "opponentStrength">): Tactics {
  const e = edge(ctx);
  if (e > 3) return tactics("4-3-3", 1);
  if (e < -3) return tactics("4-5-1", -1);
  return tactics("4-4-2", 0);
}

// A decision tree on the game state: chase the game when behind,
// protect a lead when ahead, and let the favourite push for a late winner.
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
};

// Never changes anything; handy for tests and for comparing styles
export function fixedManager(fixed: Tactics): Manager {
  return { prematch: () => fixed, inMatch: () => fixed };
}

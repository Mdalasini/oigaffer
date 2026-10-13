import { describe, expect, test } from "bun:test";
import { seededRng } from "../random";
import { SLOW_TEST, strongVsWeak } from "../test-helpers";
import { createMatchState, simulateEventMatch } from "./match";
import { dist } from "./geometry";
import { challengeSkill, fromTeamFrame, giveBall, type MatchState, type Side } from "./state";
import { moveCarrier } from "./movement";
import { attemptTackle } from "./resolve";
import { scoreOptions } from "./decide";
import { assessCross } from "./valuation";
import { DRIBBLE_BASE, DRIBBLE_SKILL, TACKLE_BALANCE, TACKLE_BASE, TACKLE_SKILL, TACKLE_STRENGTH } from "./constants";

function freshState(seed: number): MatchState {
  const world = strongVsWeak(12, 12);
  return createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(seed));
}

// Everyone well away from the action, so only the named players matter
function clearPitch(state: MatchState) {
  for (const p of state.players) p.pos = { x: p.side === "home" ? 1 : 2, y: 1 };
}

describe("jumping and strength in aerial duels", () => {
  // A home target in the box with an away defender tight on him
  function duel(targetJump: number, targetStrength: number, defenderJump = 10, defenderStrength = 10) {
    const state = freshState(11);
    clearPitch(state);
    const crosser = state.players.find((p) => p.side === "home" && p.position === "MID")!;
    crosser.pos = fromTeamFrame("home", { x: 80, y: 30 });
    const target = state.players.find((p) => p.side === "home" && p.position === "FWD")!;
    target.pos = fromTeamFrame("home", { x: 95, y: 34 });
    const defender = state.players.find((p) => p.side === "away" && p.position === "DEF")!;
    defender.pos = { x: target.pos.x + 1, y: target.pos.y };
    target.attributes.shooting = 10;
    defender.attributes.tackling = 10;
    target.attributes.jumping = targetJump;
    target.attributes.strength = targetStrength;
    defender.attributes.jumping = defenderJump;
    defender.attributes.strength = defenderStrength;
    return assessCross(state, crosser, target);
  }

  test("a higher-jumping target wins more headers than a low-jumping one", () => {
    const high = duel(18, 10);
    const low = duel(4, 10);
    expect(high.defender).not.toBeNull();
    expect(high.duel).toBeGreaterThan(low.duel);
  });

  test("a stronger target wins more headers than a weaker one", () => {
    const strong = duel(10, 18);
    const weak = duel(10, 4);
    expect(strong.duel).toBeGreaterThan(weak.duel);
  });

  test("jumping matters more than strength for the same gap", () => {
    const jumpGain = duel(18, 10).duel - duel(4, 10).duel;
    const strengthGain = duel(10, 18).duel - duel(10, 4).duel;
    expect(jumpGain).toBeGreaterThan(strengthGain);
  });

  test("a defender's jumping and strength push the duel the other way", () => {
    expect(duel(10, 10, 4, 10).duel).toBeGreaterThan(duel(10, 10, 18, 10).duel);
    expect(duel(10, 10, 10, 4).duel).toBeGreaterThan(duel(10, 10, 10, 18).duel);
  });
});

describe("strength in tackles", () => {
  // Counts tackles from a tackler of the given strength on a carrier of the given strength
  function tackleWinRate(tacklerStrength: number, carrierStrength: number): number {
    const state = freshState(21);
    clearPitch(state);
    state.referee.strictness = 0; // fouls would move players and the ball, which is not under test
    const carrier = state.players.find((p) => p.side === "home" && p.position === "MID")!;
    carrier.pos = fromTeamFrame("home", { x: 50, y: 34 });
    const tackler = state.players.find((p) => p.side === "away" && p.position === "MID")!;
    tackler.pos = { x: carrier.pos.x + 1, y: carrier.pos.y };
    tackler.attributes.strength = tacklerStrength;
    carrier.attributes.strength = carrierStrength;
    for (let i = 0; i < 6000; i++) {
      tackler.cooldown = 0;
      carrier.cooldown = 0;
      state.ball.flight = null;
      state.ball.setPiece = null;
      giveBall(state, carrier, 0);
      carrier.cooldown = 0;
      attemptTackle(state, carrier);
    }
    const attempts = state.events.filter((e) => e.type === "tackle" && e.playerId === tackler.id);
    const won = attempts.filter((e) => e.type === "tackle" && e.won).length;
    expect(attempts.length).toBeGreaterThan(500);
    return won / attempts.length;
  }

  test("a strong tackler wins a clearly larger share of tackles than a weak one", () => {
    const strongTackler = tackleWinRate(18, 4);
    const weakTackler = tackleWinRate(4, 18);
    expect(strongTackler - weakTackler).toBeGreaterThan(0.05);
  });
});

describe("strength on the first touch", () => {
  // Share of receptions where the first touch spills the ball away from the carrier
  function spillRate(carrierStrength: number): number {
    const state = freshState(31);
    clearPitch(state);
    const carrier = state.players.find((p) => p.side === "home" && p.position === "MID")!;
    carrier.attributes.passing = carrier.attributes.dribbling = 8;
    carrier.attributes.strength = carrierStrength;
    const presser = state.players.find((p) => p.side === "away" && p.position === "MID")!;
    presser.attributes.strength = 10;
    let spilled = 0;
    const trials = 4000;
    for (let i = 0; i < trials; i++) {
      // Pressure only bites within PRESSURE_RANGE, so keep the presser close and the carrier put
      carrier.pos = fromTeamFrame("home", { x: 50, y: 34 });
      presser.pos = { x: carrier.pos.x + 1.5, y: carrier.pos.y };
      giveBall(state, carrier); // automatic first touch, rolled once inside moveCarrier
      moveCarrier(state, carrier);
      // A poor touch leaves the ball a few metres off the carrier; a good one stays with them
      if (dist(state.ball.pos, carrier.pos) > 1) spilled++;
    }
    return spilled / trials;
  }

  test("a strong carrier spills the first touch less often than a weak one", () => {
    expect(spillRate(4)).toBeGreaterThan(spillRate(18) * 1.3);
  });
});

describe("physical match-level effects", () => {
  // Outfield players of one club get high jumping and strength; the other stays low.
  // Returns per-side header and tackle win rates over seeded matches, alternating home and away.
  function physicalWorld() {
    const world = strongVsWeak(12, 12);
    for (const id of world.clubs.strong!.playerIds) {
      const p = world.players[id]!;
      if (p.position === "GK") continue;
      p.attributes = { ...p.attributes, jumping: 17, strength: 17 };
    }
    for (const id of world.clubs.weak!.playerIds) {
      const p = world.players[id]!;
      if (p.position === "GK") continue;
      p.attributes = { ...p.attributes, jumping: 5, strength: 5 };
    }
    return world;
  }

  test("the physical side wins more headers and tackles than the other side", () => {
    const world = physicalWorld();
    const rng = seededRng(41);
    const tally: Record<"physical" | "other", { headers: number; headersWon: number; tackles: number; tacklesWon: number }> = {
      physical: { headers: 0, headersWon: 0, tackles: 0, tacklesWon: 0 },
      other: { headers: 0, headersWon: 0, tackles: 0, tacklesWon: 0 },
    };
    const strong = world.clubs.strong!;
    const weak = world.clubs.weak!;
    for (let m = 0; m < 40; m++) {
      const physicalHome = m % 2 === 0;
      const physicalSide: Side = physicalHome ? "home" : "away";
      const result = physicalHome
        ? simulateEventMatch(world, strong, weak, rng)
        : simulateEventMatch(world, weak, strong, rng);
      for (const e of result.events) {
        const who = e.side === physicalSide ? "physical" : "other";
        if (e.type === "cross" && (e.outcome === "won" || e.outcome === "cleared")) {
          tally[who].headers++;
          if (e.outcome === "won") tally[who].headersWon++;
        }
        if (e.type === "tackle") {
          tally[who].tackles++;
          if (e.won) tally[who].tacklesWon++;
        }
      }
    }
    const headerRate = (k: "physical" | "other") => tally[k].headersWon / tally[k].headers;
    const tackleRate = (k: "physical" | "other") => tally[k].tacklesWon / tally[k].tackles;
    expect(tally.physical.headers).toBeGreaterThan(50);
    expect(headerRate("physical")).toBeGreaterThan(headerRate("other") + 0.03);
    expect(tackleRate("physical")).toBeGreaterThan(tackleRate("other") + 0.02);
  }, SLOW_TEST);
});

describe("agility and balance in take-ons", () => {
  // Take-on chance for a home carrier past one away defender, from the scored dribble option
  function beatChance(carrierAgility: number, defenderAgility: number, defenderBalance: number): number {
    const state = freshState(51);
    clearPitch(state);
    const carrier = state.players.find((p) => p.side === "home" && p.position === "MID")!;
    carrier.pos = fromTeamFrame("home", { x: 50, y: 34 });
    carrier.attributes.agility = carrierAgility;
    const defender = state.players.find((p) => p.side === "away" && p.position === "DEF")!;
    defender.pos = { x: carrier.pos.x + 3, y: carrier.pos.y };
    defender.attributes.agility = defenderAgility;
    defender.attributes.balance = defenderBalance;
    const take = scoreOptions(state, carrier).find((o) => o.action.kind === "dribble" && o.action.defender !== null);
    if (take?.action.kind !== "dribble") throw new Error("no take-on option");
    return take.action.beat;
  }

  test("an agile carrier beats a defender more often than a stiff one", () => {
    expect(beatChance(18, 10, 10)).toBeGreaterThan(beatChance(4, 10, 10));
  });

  test("a well-balanced defender is harder to get past", () => {
    expect(beatChance(10, 10, 4)).toBeGreaterThan(beatChance(10, 10, 18));
  });

  test("with everyone at 10 the take-on chance is the formula without the new terms", () => {
    const state = freshState(61);
    clearPitch(state);
    for (const p of state.players) {
      p.attributes.agility = 10;
      p.attributes.balance = 10;
    }
    const carrier = state.players.find((p) => p.side === "home" && p.position === "MID")!;
    carrier.pos = fromTeamFrame("home", { x: 50, y: 34 });
    const defender = state.players.find((p) => p.side === "away" && p.position === "DEF")!;
    defender.pos = { x: carrier.pos.x + 3, y: carrier.pos.y };
    const take = scoreOptions(state, carrier).find((o) => o.action.kind === "dribble" && o.action.defender !== null);
    if (take?.action.kind !== "dribble") throw new Error("no take-on option");
    const expected = Math.min(0.9, Math.max(0.15, DRIBBLE_BASE + DRIBBLE_SKILL * (carrier.attributes.dribbling - challengeSkill(defender))));
    expect(take.action.beat).toBeCloseTo(expected, 12);
  });
});

describe("balance in tackles", () => {
  // Win chance for a tackle, found by bisection on the roll: a roll below the win chance wins it
  function winChanceAt(state: MatchState, carrier: (typeof state.players)[number], tackler: (typeof state.players)[number], roll: number): boolean {
    giveBall(state, carrier, 0);
    tackler.cooldown = 0;
    carrier.cooldown = 0;
    state.ball.flight = null;
    state.ball.setPiece = null;
    state.events.length = 0;
    let calls = 0;
    state.rng = () => (calls++ === 0 ? 0 : roll); // first roll: the tackle is attempted
    attemptTackle(state, carrier);
    return state.events.some((e) => e.type === "tackle" && e.won);
  }

  test("the win chance is the formula with the balance term, and exactly the old formula at 10", () => {
    const state = freshState(71);
    clearPitch(state);
    for (const p of state.players) {
      p.attributes.agility = 10;
      p.attributes.balance = 10;
    }
    state.referee.strictness = 0;
    const carrier = state.players.find((p) => p.side === "home" && p.position === "MID")!;
    carrier.pos = fromTeamFrame("home", { x: 50, y: 34 });
    const tackler = state.players.find((p) => p.side === "away" && p.position === "MID")!;
    tackler.pos = { x: carrier.pos.x + 1, y: carrier.pos.y };
    const bisect = (lo: number, hi: number) => {
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (winChanceAt(state, carrier, tackler, mid)) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const threshold = bisect(0, 1);
    const oldFormula = TACKLE_BASE + TACKLE_SKILL * (challengeSkill(tackler) - carrier.attributes.dribbling) + TACKLE_STRENGTH * (tackler.attributes.strength - carrier.attributes.strength);
    expect(threshold).toBeCloseTo(Math.min(0.8, Math.max(0.1, oldFormula)), 9);
    // With balance raised, the same roll is more likely to lose the ball
    carrier.attributes.balance = 18;
    const raised = bisect(0, 1);
    expect(threshold - raised).toBeCloseTo(TACKLE_BALANCE * 8, 9);
  });

  // Share of tackles a carrier of the given balance loses, from a fixed tackler
  function lossRate(carrierBalance: number): number {
    const state = freshState(81);
    clearPitch(state);
    state.referee.strictness = 0; // fouls would move players and the ball, which is not under test
    const carrier = state.players.find((p) => p.side === "home" && p.position === "MID")!;
    carrier.pos = fromTeamFrame("home", { x: 50, y: 34 });
    const tackler = state.players.find((p) => p.side === "away" && p.position === "MID")!;
    tackler.pos = { x: carrier.pos.x + 1, y: carrier.pos.y };
    carrier.attributes.balance = carrierBalance;
    for (let i = 0; i < 6000; i++) {
      tackler.cooldown = 0;
      carrier.cooldown = 0;
      state.ball.flight = null;
      state.ball.setPiece = null;
      giveBall(state, carrier, 0);
      carrier.cooldown = 0;
      attemptTackle(state, carrier);
    }
    const attempts = state.events.filter((e) => e.type === "tackle" && e.playerId === tackler.id);
    const won = attempts.filter((e) => e.type === "tackle" && e.won).length;
    expect(attempts.length).toBeGreaterThan(500);
    return won / attempts.length;
  }

  test("a well-balanced carrier loses a smaller share of tackles", () => {
    expect(lossRate(4) - lossRate(18)).toBeGreaterThan(0.04);
  });
});

describe("agility and balance match-level effects", () => {
  // One club is quick and balanced; the other is stiff. Alternates home and away.
  function agileWorld() {
    const world = strongVsWeak(12, 12);
    for (const [club, agility] of [[world.clubs.strong!, 17], [world.clubs.weak!, 5]] as const) {
      for (const id of club.playerIds) {
        const p = world.players[id]!;
        if (p.position === "GK") continue;
        p.attributes = { ...p.attributes, agility, balance: agility };
      }
    }
    return world;
  }

  // Completed contested take-ons (a dribble past a named defender) by each side, over seeded matches.
  // Failed take-ons are emitted as won tackles, so they cannot be told apart from tackle wins in the
  // events; the tackle balance effect is checked on hand-built tackles above instead.
  test("the agile side completes more take-ons than the stiff side", () => {
    const world = agileWorld();
    const rng = seededRng(91);
    const strong = world.clubs.strong!;
    const weak = world.clubs.weak!;
    const completed = { agile: 0, stiff: 0 };
    for (let m = 0; m < 40; m++) {
      const agileHome = m % 2 === 0;
      const agileSide: Side = agileHome ? "home" : "away";
      const result = agileHome ? simulateEventMatch(world, strong, weak, rng) : simulateEventMatch(world, weak, strong, rng);
      for (const e of result.events) {
        if (e.type === "dribble" && e.defenderId !== null) completed[e.side === agileSide ? "agile" : "stiff"]++;
      }
    }
    expect(completed.agile).toBeGreaterThan(completed.stiff * 5);
  }, SLOW_TEST);
});

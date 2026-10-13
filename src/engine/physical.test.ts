import { describe, expect, test } from "bun:test";
import { seededRng } from "../random";
import { SLOW_TEST, strongVsWeak } from "../test-helpers";
import { createMatchState, simulateEventMatch } from "./match";
import { dist } from "./geometry";
import { fromTeamFrame, giveBall, type MatchState, type Side } from "./state";
import { moveCarrier } from "./movement";
import { attemptTackle } from "./resolve";
import { assessCross } from "./valuation";

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

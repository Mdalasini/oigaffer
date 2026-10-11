import type { MatchResult } from "../match";
import type { Club, GameWorld } from "../model";
import type { Rng } from "../random";
import { HALF_TIME, MATCH_SECONDS } from "./constants";
import { chooseAction } from "./decide";
import { assignSlots, kickoff } from "./formation";
import { PITCH_LENGTH, PITCH_WIDTH } from "./geometry";
import { moveOffBall, pickUpLooseBall } from "./movement";
import { act, attemptTackle } from "./resolve";
import { fromTeamFrame, owner, type MatchEvent, type MatchPlayer, type MatchState } from "./state";

export interface EventMatchResult extends MatchResult {
  events: MatchEvent[];
}

export function createMatchState(world: GameWorld, home: Club, away: Club, rng: Rng): MatchState {
  const players: MatchPlayer[] = [];
  for (const [side, club] of [["home", home], ["away", away]] as const) {
    const squad = club.playerIds.map((id) => {
      const p = world.players[id];
      if (!p) throw new Error(`Club ${club.id} references unknown player ${id}`);
      return p;
    });
    const slots = assignSlots(squad.map((p) => p.position));
    squad.forEach((p, i) => {
      const slot = slots[i]!;
      players.push({
        id: p.id,
        side,
        position: p.position,
        attributes: p.attributes,
        slot,
        pos: fromTeamFrame(side, slot),
        cooldown: 0,
      });
    });
  }
  return {
    time: 0,
    players,
    ball: { pos: { x: PITCH_LENGTH / 2, y: PITCH_WIDTH / 2 }, ownerId: null, lastSide: "home", readyAt: 0 },
    score: { home: 0, away: 0 },
    xg: { home: 0, away: 0 },
    events: [],
    rng,
  };
}

// One second of play: the carrier may be challenged, then (once they've
// controlled the ball) decides and acts;
// everyone else moves; a loose ball goes to whoever reaches it.
export function tick(state: MatchState): void {
  for (const p of state.players) if (p.cooldown > 0) p.cooldown--;

  const carrier = owner(state);
  if (carrier && !attemptTackle(state, carrier) && state.time >= state.ball.readyAt) {
    act(state, carrier, chooseAction(state, carrier));
  }

  moveOffBall(state);
  if (state.ball.ownerId === null) pickUpLooseBall(state);
}

export function simulateEventMatch(world: GameWorld, home: Club, away: Club, rng: Rng = Math.random): EventMatchResult {
  const state = createMatchState(world, home, away, rng);
  kickoff(state, "home");
  for (let t = 1; t <= MATCH_SECONDS; t++) {
    state.time = t;
    if (t === HALF_TIME + 1) kickoff(state, "away");
    tick(state);
  }
  return {
    homeGoals: state.score.home,
    awayGoals: state.score.away,
    homeXg: state.xg.home,
    awayXg: state.xg.away,
    events: state.events,
  };
}

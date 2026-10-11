import type { Id, Position } from "../model";
import { lineRating } from "../squad";
import { assignRoles, type Tactics } from "../tactics";
import { ADDED, MAX_SUBS } from "./constants";
import { arrangeSide } from "./formation";
import { CENTRE } from "./geometry";
import { emit, nearest, opponent, type MatchPlayer, type MatchState, type OffPitch, type Side } from "./state";

const onSide = (state: MatchState, side: Side) => state.players.filter((p) => p.side === side);

// Fits whoever is on the pitch into the formation, logging who moved
function fitRoles(state: MatchState, side: Side, tactics: Tactics) {
  const team = onSide(state, side);
  const roles = assignRoles(
    team.map((p) => ({ id: p.id, role: p.position, attributes: p.base })),
    tactics.formation,
  );
  const moved: { playerId: Id; from: Position; to: Position }[] = [];
  for (const p of team) {
    const role = roles.get(p.id)!;
    if (role !== p.position) moved.push({ playerId: p.id, from: p.position, to: role });
    p.position = role;
  }
  arrangeSide(state, side);
  return moved;
}

// Switches a side to new tactics, moving players between lines if the formation changed
export function applyTactics(state: MatchState, side: Side, tactics: Tactics, force = false): void {
  const current = state.teams[side].tactics;
  if (!force && current.formation === tactics.formation && current.mentality === tactics.mentality) return;
  const moved = fitRoles(state, side, tactics);
  state.teams[side].tactics = tactics;
  emit(state, { type: "tactics", side, formation: tactics.formation, mentality: tactics.mentality, moved });
}

function takeOff(state: MatchState, p: MatchPlayer, reason: OffPitch["reason"]): void {
  state.players = state.players.filter((q) => q !== p);
  state.offPitch.push({ id: p.id, side: p.side, natural: p.natural, attributes: p.base, reason });
  if (state.ball.ownerId === p.id) {
    state.ball.ownerId = null;
    if (reason !== "substituted" && state.ball.setPiece !== null) {
      const taker = nearest(onSide(state, p.side).filter((q) =>
        q.position !== "GK" || state.ball.setPiece === "goal_kick"
      ), state.ball.pos);
      if (taker) {
        state.ball.ownerId = taker.id;
      }
    }
  }
  state.teams[p.side].pendingSubs = state.teams[p.side].pendingSubs.filter((s) => s.offId !== p.id);
}

function abandonIfShort(state: MatchState, side: Side): void {
  if (state.phase === "abandoned" || onSide(state, side).length >= 7) return;
  const winner = opponent(side);
  if (state.score[winner] - state.score[side] < 3) {
    state.score[side] = 0;
    state.score[winner] = 3;
  }
  emit(state, { type: "whistle", side, phase: "abandoned" });
  state.phase = "abandoned";
  state.ball.flight = null;
  state.ball.height = 0;
}

// Down to ten: the shape closes up around the gap (the front line loses a player first).
// If it was the keeper, the best outfield keeper goes in goal.
export function sendOff(state: MatchState, p: MatchPlayer): void {
  takeOff(state, p, "sent_off");
  fitRoles(state, p.side, state.teams[p.side].tactics);
  abandonIfShort(state, p.side);
}

export const subsLeft = (state: MatchState, side: Side): number => MAX_SUBS - state.teams[side].subsUsed;

export const bench = (state: MatchState, side: Side): OffPitch[] =>
  state.offPitch.filter((o) => o.side === side && o.reason === "bench");

// The best available replacement for a role, preferring natural players for it
export function likeForLike(state: MatchState, side: Side, role: Position): OffPitch | undefined {
  const pending = new Set(state.teams[side].pendingSubs.map((s) => s.onId));
  const options = bench(state, side).filter((o) => !pending.has(o.id));
  const score = (o: OffPitch) => lineRating(o.attributes, role) + (o.natural === role ? 3 : 0);
  return options.reduce<OffPitch | undefined>((a, b) => (!a || score(b) > score(a) ? b : a), undefined);
}

// A hurt player can't continue: they're replaced at once if there's a sub left,
// otherwise the team plays on a man down
export function injure(state: MatchState, p: MatchPlayer): void {
  emit(state, { type: "injury", side: p.side, playerId: p.id });
  state.stoppage += ADDED.injury;
  const replacement = subsLeft(state, p.side) > 0 ? likeForLike(state, p.side, p.position) : undefined;
  if (replacement) {
    substitute(state, p.side, p.id, replacement.id);
  } else {
    takeOff(state, p, "injured");
    fitRoles(state, p.side, state.teams[p.side].tactics);
    abandonIfShort(state, p.side);
  }
}

// Asks for a change at the next stoppage. Returns false if it isn't allowed.
export function requestSub(state: MatchState, side: Side, offId: Id, onId: Id): boolean {
  const team = state.teams[side];
  const valid =
    state.players.some((p) => p.id === offId && p.side === side) &&
    bench(state, side).some((o) => o.id === onId) &&
    team.pendingSubs.length < subsLeft(state, side) &&
    !team.pendingSubs.some((s) => s.offId === offId || s.onId === onId);
  if (valid) team.pendingSubs.push({ offId, onId });
  return valid;
}

// The replacement enters at halfway and runs into the outgoing player's role
export function substitute(state: MatchState, side: Side, offId: Id, onId: Id): boolean {
  const off = state.players.find((p) => p.id === offId && p.side === side);
  const on = bench(state, side).find((o) => o.id === onId);
  if (!off || !on || subsLeft(state, side) <= 0) return false;

  const incoming: MatchPlayer = {
    id: on.id,
    side,
    position: off.position,
    natural: on.natural,
    base: on.attributes,
    attributes: { ...on.attributes },
    energy: 1,
    slot: off.slot,
    pos: { x: CENTRE.x, y: 0 },
    cooldown: 0,
    yellow: false,
  };
  const hadBall = state.ball.ownerId === off.id;
  takeOff(state, off, "substituted");
  state.offPitch = state.offPitch.filter((o) => o.id !== on.id);
  state.players.push(incoming);
  if (hadBall) state.ball.ownerId = incoming.id;

  // A keeper coming on takes the gloves back from a stand-in
  const standIn = state.players.find((p) => p.side === side && p.position === "GK" && p.natural !== "GK");
  if (on.natural === "GK" && standIn && standIn !== incoming) {
    standIn.position = incoming.position;
    incoming.position = "GK";
    arrangeSide(state, side);
  }

  state.teams[side].subsUsed++;
  state.stoppage += ADDED.substitution;
  emit(state, { type: "substitution", side, offId, onId });
  return true;
}

// Changes wait for the ball to go dead
export function makePendingSubs(state: MatchState): void {
  for (const side of ["home", "away"] as const) {
    const pending = state.teams[side].pendingSubs;
    state.teams[side].pendingSubs = [];
    for (const { offId, onId } of pending) substitute(state, side, offId, onId);
  }
}

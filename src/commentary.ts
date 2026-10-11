import { HALF_TIME, MATCH_SECONDS } from "./engine/constants";
import type { MatchEvent, Period, Side } from "./engine/state";
import { MENTALITY_NAMES } from "./tactics";

export interface CommentaryLine {
  period: Period;
  clock: number;
  side: Side | null;
  text: string;
  kind: "goal" | "chance" | "card" | "tactics" | "info";
}

export interface Names {
  club: (side: Side) => string;
  player: (id: string) => string;
}

// 1' for the first minute of play; added time reads 45+2' or 90+4'
export function minuteLabel(period: Period, clock: number): string {
  const end = (period === 1 ? HALF_TIME : MATCH_SECONDS) / 60;
  const start = period === 1 ? 1 : HALF_TIME / 60 + 1;
  const minute = Math.max(start, Math.floor((clock - 1) / 60) + 1);
  return minute > end ? `${end}+${minute - end}'` : `${minute}'`;
}

const SHOT_TEXT = {
  open_play: {
    goal: "GOAL! {p} scores for {c}!",
    saved: "{p} shoots, but {k} saves.",
    off_target: "{p} fires wide.",
    blocked: "{p}'s shot is blocked.",
  },
  header: {
    goal: "GOAL! {p} heads in for {c}!",
    saved: "{p} gets a header on target, but {k} saves.",
    off_target: "{p} heads over.",
    blocked: "{p}'s header is blocked.",
  },
  free_kick: {
    goal: "GOAL! {p} curls the free kick in for {c}!",
    saved: "{p}'s free kick is saved by {k}.",
    off_target: "{p}'s free kick clears the bar.",
    blocked: "{p}'s free kick hits the wall.",
  },
  penalty: {
    goal: "GOAL! {p} scores the penalty for {c}!",
    saved: "{k} saves {p}'s penalty!",
    off_target: "{p} misses the penalty!",
    blocked: "{p}'s penalty is blocked.",
  },
} as const;

// Turns one match event into a line of commentary, or null for routine play.
// Only the moments a manager reacts to make the feed: chances, goals, cards,
// changes and the referee's big calls. Passes, through balls, take-ons and
// throw-ins happen dozens of times a game and would bury them.
export function describe(e: MatchEvent, names: Names): CommentaryLine | null {
  const line = (text: string, kind: CommentaryLine["kind"] = "info", side: Side | null = e.side): CommentaryLine => ({
    period: e.period,
    clock: e.clock,
    side,
    text,
    kind,
  });
  const p = (id: string) => names.player(id);
  const club = names.club(e.side);

  switch (e.type) {
    case "kickoff":
      if (e.time === 0) return line(`${club} get us under way.`);
      if (e.period === 2 && e.clock === HALF_TIME) return line(`The second half begins.`);
      return null; // restarts after goals add nothing
    case "shot": {
      const big = e.xg >= 0.3 && e.outcome !== "goal" && e.kind !== "penalty" ? " What a chance!" : "";
      const text = SHOT_TEXT[e.kind][e.outcome]
        .replace("{p}", p(e.playerId))
        .replace("{c}", club)
        .replace("{k}", e.keeperId ? p(e.keeperId) : "the keeper");
      return line(text + big, e.outcome === "goal" ? "goal" : "chance");
    }
    case "set_piece":
      if (e.kind === "corner") return line(`Corner to ${club}.`);
      if (e.kind === "penalty") return line(`Penalty to ${club}! ${p(e.playerId)} will take it.`, "chance");
      return null;
    case "foul":
      return e.award === "advantage" ? line(`${p(e.playerId)} fouls ${p(e.victimId)}, but the ref plays advantage.`) : null;
    case "card":
      if (e.card === "yellow") return line(`Yellow card for ${p(e.playerId)}.`, "card");
      if (e.card === "second_yellow") return line(`Second yellow! ${p(e.playerId)} is sent off.`, "card");
      return line(`Red card! ${p(e.playerId)} is sent off.`, "card");
    case "offside":
      return line(`${p(e.playerId)} is flagged offside.`);
    case "injury":
      return line(`${p(e.playerId)} is hurt and can't continue.`);
    case "substitution":
      return line(`${club} change: ${p(e.onId)} on, ${p(e.offId)} off.`, "tactics");
    case "added_time":
      return line(`${e.minutes} minute${e.minutes === 1 ? "" : "s"} added on.`, "info", null);
    case "whistle":
      return line(e.phase === "abandoned" ? "The match is abandoned." : e.phase === "half_time" ? "Half time." : "Full time.", "info", null);
    case "tactics": {
      const setup = `${e.formation}, ${MENTALITY_NAMES[e.mentality]}`;
      if (e.time === 0) return line(`${club} line up ${setup}.`, "tactics");
      const moves = e.moved.map((m) => `${p(m.playerId)} ${m.from}→${m.to}`).join(", ");
      return line(`${club} switch to ${setup}${moves ? ` (${moves})` : ""}.`, "tactics");
    }
    default:
      return null;
  }
}

export const commentary = (events: MatchEvent[], names: Names): CommentaryLine[] =>
  events.map((e) => describe(e, names)).filter((l) => l !== null);

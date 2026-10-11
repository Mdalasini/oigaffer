import { HALF_TIME, MATCH_SECONDS } from "./engine/constants";
import type { MatchEvent, Side } from "./engine/state";
import { MENTALITY_NAMES } from "./tactics";

export interface CommentaryLine {
  time: number;
  side: Side | null;
  text: string;
  kind: "goal" | "chance" | "tactics" | "info";
}

export interface Names {
  club: (side: Side) => string;
  player: (id: string) => string;
}

// 1' for the first minute of play, 90' for the last
export const matchMinute = (time: number): number => Math.max(1, Math.floor((time - 1) / 60) + 1);

const SHOT_TEXT = {
  goal: "GOAL! {p} scores for {c}!",
  saved: "{p} shoots, but {k} saves.",
  off_target: "{p} fires wide.",
  blocked: "{p}'s shot is blocked.",
} as const;

// Turns one match event into a line of commentary, or null for routine play.
// Only the moments a manager reacts to make the feed: chances, goals and
// tactical changes. Through balls and take-ons happen dozens of times a game
// and would bury them.
export function describe(e: MatchEvent, names: Names): CommentaryLine | null {
  const line = (text: string, kind: CommentaryLine["kind"] = "info"): CommentaryLine => ({
    time: e.time,
    side: e.side,
    text,
    kind,
  });
  const p = (id: string) => names.player(id);

  switch (e.type) {
    case "kickoff":
      if (e.time === 0) return line(`${names.club(e.side)} get us under way.`);
      if (e.time === HALF_TIME + 1) return line(`The second half begins.`);
      return null; // restarts after goals add nothing
    case "shot": {
      const xg = e.xg >= 0.3 ? " What a chance!" : "";
      const text = SHOT_TEXT[e.outcome]
        .replace("{p}", p(e.playerId))
        .replace("{c}", names.club(e.side))
        .replace("{k}", e.keeperId ? p(e.keeperId) : "the keeper");
      return line(e.outcome === "goal" ? text : text + xg, e.outcome === "goal" ? "goal" : "chance");
    }
    case "tactics": {
      const setup = `${e.formation}, ${MENTALITY_NAMES[e.mentality]}`;
      if (e.time === 0) return line(`${names.club(e.side)} line up ${setup}.`, "tactics");
      const moves = e.moved.map((m) => `${p(m.playerId)} ${m.from}→${m.to}`).join(", ");
      return line(`${names.club(e.side)} switch to ${setup}${moves ? ` (${moves})` : ""}.`, "tactics");
    }
    default:
      return null;
  }
}

// The full feed up to `time`, with the whistles added
export function commentary(events: MatchEvent[], time: number, names: Names): CommentaryLine[] {
  const whistle = (t: number, text: string): CommentaryLine => ({ time: t, side: null, text, kind: "info" });
  const lines: CommentaryLine[] = [];
  let halfTime = false;
  for (const e of events) {
    if (!halfTime && e.time > HALF_TIME) {
      lines.push(whistle(HALF_TIME, "Half time."));
      halfTime = true;
    }
    const l = describe(e, names);
    if (l) lines.push(l);
  }
  if (!halfTime && time >= HALF_TIME) lines.push(whistle(HALF_TIME, "Half time."));
  if (time >= MATCH_SECONDS) lines.push(whistle(MATCH_SECONDS, "Full time."));
  return lines;
}

import { PITCH_LENGTH, PITCH_WIDTH, dist, type Vec } from "../engine/geometry";
import type { MatchEvent } from "../engine/state";
import type { Id } from "../model";
import type { Frame, Recording, Strike, Touch } from "./record";

// Analyst views of a recording, as numbers and text grids. Each view takes whatever
// selection of frames, touches or strikes you hand it: one player, a line, a team, in
// or out of possession. Everything is in the team frame: x runs from a player's own
// goal line (0) to the opponents' (105); y runs from one touchline (0) to the other (68).

const MATCH_SECONDS = 5400;
export const HIGH_INTENSITY_SPEED = 5.5; // m/s, about 20 km/h, the usual high-speed running threshold
export const SPRINT_SPEED = 7; // m/s, about 25 km/h
const PROGRESSIVE_GAIN = 10; // m towards the opponents' goal line

// ---------- Zone grids (heat maps, touch maps, pass origins and destinations) ----------

export interface Grid {
  cols: number; // along the pitch, own goal first
  rows: number; // across the pitch, y = 0 first
  cells: number[]; // share of the points in each zone, row-major
  count: number;
}

export function grid(points: Vec[], cols = 6, rows = 3): Grid {
  const cells = new Array<number>(cols * rows).fill(0);
  for (const p of points) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((p.x / PITCH_LENGTH) * cols)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor((p.y / PITCH_WIDTH) * rows)));
    cells[r * cols + c]!++;
  }
  const n = Math.max(1, points.length);
  return { cols, rows, cells: cells.map((v) => v / n), count: points.length };
}

// Percentages per zone, attacking left to right
export function formatGrid(g: Grid, title = ""): string {
  const lines = [`${title}${title ? " " : ""}(n=${g.count}, % per zone, own goal | → | opponents' goal)`];
  for (let r = 0; r < g.rows; r++) {
    const row = g.cells.slice(r * g.cols, (r + 1) * g.cols).map((v) => (v * 100).toFixed(0).padStart(4));
    lines.push(`  y${r} |${row.join("")} |`);
  }
  return lines.join("\n");
}

// Zone cells as named numbers (e.g. "heat.r1c4"), so grids can go through compare()
export function gridMetrics(g: Grid, prefix: string): Record<string, number> {
  const out: Record<string, number> = {};
  g.cells.forEach((v, i) => (out[`${prefix}.r${Math.floor(i / g.cols)}c${i % g.cols}`] = v));
  return out;
}

export const heatMap = (frames: Frame[], cols?: number, rows?: number): Grid => grid(frames.map((f) => f.pos), cols, rows);
export const touchMap = (touches: Touch[], cols?: number, rows?: number): Grid => grid(touches.map((t) => t.pos), cols, rows);

// ---------- Average position ----------

export interface AveragePosition {
  seconds: number;
  x: number;
  y: number;
  width: number; // mean distance from the middle of the pitch, across
  fromSlot: number; // mean distance from the formation anchor, m
}

export function averagePosition(frames: Frame[]): AveragePosition {
  let x = 0, y = 0, width = 0, fromSlot = 0;
  for (const f of frames) {
    x += f.pos.x;
    y += f.pos.y;
    width += Math.abs(f.pos.y - PITCH_WIDTH / 2);
    fromSlot += dist(f.pos, f.slot);
  }
  const n = Math.max(1, frames.length);
  return { seconds: frames.length, x: x / n, y: y / n, width: width / n, fromSlot: fromSlot / n };
}

// ---------- Running ----------

export interface Running {
  minutes: number; // player-minutes in the selection
  per90: number; // metres per 90 minutes of one player
  highIntensityPer90: number;
  sprintsPer90: number;
}

export function running(frames: Frame[]): Running {
  let distance = 0, high = 0, sprints = 0;
  const wasSprinting = new Map<Id, boolean>();
  for (const f of frames) {
    distance += f.speed; // one-second frames
    if (f.speed >= HIGH_INTENSITY_SPEED) high += f.speed;
    const sprinting = f.speed >= SPRINT_SPEED;
    if (sprinting && !wasSprinting.get(f.id)) sprints++;
    wasSprinting.set(f.id, sprinting);
  }
  const per90 = MATCH_SECONDS / Math.max(1, frames.length);
  return { minutes: frames.length / 60, per90: distance * per90, highIntensityPer90: high * per90, sprintsPer90: sprints * per90 };
}

// ---------- Passing ----------

export interface Passing {
  attempts: number;
  kept: number; // share where the striker's team got the ball next
  forward: number; // share gaining ground
  progressive: number; // share gaining at least PROGRESSIVE_GAIN
  length: number; // mean, m
  byType: Record<string, number>;
  from: Grid;
  to: Grid;
}

const PASS_TYPES = new Set<Strike["type"]>(["pass", "through_ball", "interception", "pass_astray", "offside", "cross"]);

// Passes and crosses (strikes other than shots and clearances)
export function passing(strikes: Strike[], cols?: number, rows?: number): Passing {
  const passes = strikes.filter((s) => PASS_TYPES.has(s.type));
  const resolved = passes.filter((s) => s.kept !== null);
  const n = Math.max(1, passes.length);
  const byType: Record<string, number> = {};
  for (const s of passes) byType[s.type] = (byType[s.type] ?? 0) + 1;
  return {
    attempts: passes.length,
    kept: resolved.filter((s) => s.kept).length / Math.max(1, resolved.length),
    forward: passes.filter((s) => s.to.x > s.from.x).length / n,
    progressive: passes.filter((s) => s.to.x - s.from.x >= PROGRESSIVE_GAIN).length / n,
    length: passes.reduce((sum, s) => sum + dist(s.from, s.to), 0) / n,
    byType,
    from: grid(passes.map((s) => s.from), cols, rows),
    to: grid(passes.map((s) => s.to), cols, rows),
  };
}

// ---------- Actions and the passing network ----------

// Event counts for the players in `ids`. An interception counts for the interceptor,
// and as "pass_intercepted" for the passer.
export function actionMix(events: MatchEvent[], ids: Set<Id>): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (key: string) => (out[key] = (out[key] ?? 0) + 1);
  for (const e of events) {
    if (e.type === "interception") {
      if (ids.has(e.interceptorId)) add("interception");
      if (ids.has(e.playerId)) add("pass_intercepted");
    } else if ("playerId" in e && ids.has(e.playerId)) {
      add(e.type === "tackle" ? (e.won ? "tackle_won" : "tackle_lost") : e.type);
    }
  }
  return out;
}

export interface NetworkLink {
  from: Id;
  to: Id;
  count: number;
}

// Completed passes between teammates, most frequent first
export function passNetwork(strikes: Strike[]): NetworkLink[] {
  const links = new Map<string, NetworkLink>();
  for (const s of strikes) {
    if ((s.type !== "pass" && s.type !== "through_ball" && s.type !== "cross") || !s.kept || !s.receiverId) continue;
    const key = `${s.id}>${s.receiverId}`;
    const link = links.get(key) ?? { from: s.id, to: s.receiverId, count: 0 };
    link.count++;
    links.set(key, link);
  }
  return [...links.values()].sort((a, b) => b.count - a.count);
}

// ---------- A full report for one player or a group ----------

const fmt = (v: number, digits = 1) => v.toFixed(digits);

export function report(rec: Recording, ids: Id[], label = ids.join(",")): string {
  const set = new Set(ids);
  const frames = rec.frames.filter((f) => set.has(f.id));
  const live = frames.filter((f) => !f.dead);
  const touches = rec.touches.filter((t) => set.has(t.id));
  const strikes = rec.strikes.filter((s) => set.has(s.id));
  const pos = (phase: Frame["phase"]) => averagePosition(live.filter((f) => f.phase === phase));
  const a = pos("attack");
  const d = pos("defend");
  const run = running(frames);
  const pass = passing(strikes);
  const lines = [
    `== ${label} (${fmt(run.minutes, 0)} player-minutes)`,
    `average position  in possession x ${fmt(a.x)} y ${fmt(a.y)} width ${fmt(a.width)} from slot ${fmt(a.fromSlot)}`,
    `                  out of possession x ${fmt(d.x)} y ${fmt(d.y)} width ${fmt(d.width)} from slot ${fmt(d.fromSlot)}`,
    `running per 90    ${fmt(run.per90, 0)} m, ${fmt(run.highIntensityPer90, 0)} m high intensity, ${fmt(run.sprintsPer90)} sprints`,
    `passing           ${pass.attempts} attempts, ${fmt(pass.kept * 100, 0)}% kept, ${fmt(pass.forward * 100, 0)}% forward, ${fmt(pass.progressive * 100, 0)}% progressive, ${fmt(pass.length)} m long`,
    `                  ${JSON.stringify(pass.byType)}`,
    `actions           ${JSON.stringify(actionMix(rec.events, set))}`,
    formatGrid(heatMap(live.filter((f) => f.phase === "attack")), "heat map in possession"),
    formatGrid(heatMap(live.filter((f) => f.phase === "defend")), "heat map out of possession"),
    formatGrid(touchMap(touches.filter((t) => t.phase === "open_play")), "touch map (open play)"),
    formatGrid(pass.to, "pass destinations"),
  ];
  return lines.join("\n");
}

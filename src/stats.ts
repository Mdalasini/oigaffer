import type { MatchEvent, Side } from "./engine/state";

export interface TeamStats {
  goals: number;
  xg: number;
  shots: number;
  onTarget: number;
  passes: number;
  passAccuracy: number; // 0–1
  possession: number; // 0–1, share of completed passes
  tacklesWon: number;
  interceptions: number;
  clearances: number;
  throughBalls: number;
}

// Box-score stats for one side, counted from the event log
export function teamStats(events: MatchEvent[], side: Side): TeamStats {
  const count = (pred: (e: MatchEvent) => boolean) => events.filter(pred).length;
  const ours = (e: MatchEvent) => e.side === side;

  const shots = events.filter((e): e is MatchEvent & { type: "shot" } => e.type === "shot" && ours(e));
  const passes = count((e) => e.type === "pass" && ours(e));
  const allPasses = count((e) => e.type === "pass");
  // An interception is credited to the side that won the ball
  const failed = count((e) => (e.type === "pass_astray" && ours(e)) || (e.type === "interception" && !ours(e)));

  return {
    goals: shots.filter((s) => s.outcome === "goal").length,
    xg: shots.reduce((sum, s) => sum + s.xg, 0),
    shots: shots.length,
    onTarget: shots.filter((s) => s.outcome === "goal" || s.outcome === "saved").length,
    passes,
    passAccuracy: passes / Math.max(1, passes + failed),
    possession: allPasses === 0 ? 0.5 : passes / allPasses,
    tacklesWon: count((e) => e.type === "tackle" && e.won && ours(e)),
    interceptions: count((e) => e.type === "interception" && ours(e)),
    clearances: count((e) => e.type === "clearance" && ours(e)),
    throughBalls: count((e) => e.type === "through_ball" && ours(e)),
  };
}

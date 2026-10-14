import type { Point } from "./shooting";

export function directionTo(from: Point, toX: number, toY: number) {
  const dx = toX - from[0];
  const dy = toY - from[1];
  const distance = Math.hypot(dx, dy);
  return { distance, onwardX: distance > 0 ? dx / distance : 0, onwardY: distance > 0 ? dy / distance : 0 };
}

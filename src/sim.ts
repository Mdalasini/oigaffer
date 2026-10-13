import { stepBall } from "./ball";
import { think } from "./brain";
import { DT } from "./constants";
import { GOAL_CENTRE, GOAL_HALF_WIDTH, GOAL_HEIGHT, PITCH_LENGTH, PITCH_WIDTH } from "./pitch";
import { steer } from "./player";
import type { World } from "./world";

// One step: players decide (and may touch the ball), then everyone and the ball move
export function step(w: World): void {
  if (w.result) return;
  for (const p of w.players) think(w, p);
  for (const p of w.players) steer(p, DT);

  const before = { x: w.ball.pos.x, y: w.ball.pos.y, z: w.ball.z };
  stepBall(w.ball, DT);
  w.time += DT;

  const { pos, z } = w.ball;
  if (before.x < PITCH_LENGTH && pos.x >= PITCH_LENGTH) {
    // Where it crossed the line, not where it ended up
    const t = (PITCH_LENGTH - before.x) / (pos.x - before.x);
    const y = before.y + (pos.y - before.y) * t;
    const h = before.z + (z - before.z) * t;
    const inside = Math.abs(y - GOAL_CENTRE.y) < GOAL_HALF_WIDTH && h < GOAL_HEIGHT;
    w.result = { kind: inside ? "goal" : "out", time: w.time };
  } else if (pos.x < 0 || pos.y < 0 || pos.y > PITCH_WIDTH) {
    w.result = { kind: "out", time: w.time };
  } else if (w.time >= w.timeLimit) {
    w.result = { kind: "time", time: w.time };
  }
}

export function play(w: World): World {
  while (!w.result) step(w);
  return w;
}

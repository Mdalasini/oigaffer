import { TIME_STEP } from "../src/constants";
import { step } from "../src/systems";
import type { Game } from "../src/world";

const MAX_SECONDS_TO_CATCH_UP = 0.25;

export function runEveryFrame(world: Game, draw: () => void): () => void {
  let unsimulatedSeconds = 0;
  let lastFrame = performance.now();
  let nextFrame = 0;
  function frame(now: number) {
    unsimulatedSeconds += Math.min(MAX_SECONDS_TO_CATCH_UP, (now - lastFrame) / 1000);
    lastFrame = now;
    while (unsimulatedSeconds >= TIME_STEP) {
      step(world);
      unsimulatedSeconds -= TIME_STEP;
    }
    draw();
    nextFrame = requestAnimationFrame(frame);
  }
  nextFrame = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(nextFrame);
}

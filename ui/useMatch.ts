import { useEffect, useReducer, useRef, useState } from "react";
import { applyTactics, isFullTime, requestSub, startEventMatch, stepEventMatch } from "../src/engine/match";
import type { MatchState, Side } from "../src/engine/state";
import { humanManager } from "../src/manager";
import type { Club, GameWorld } from "../src/model";
import { seededRng } from "../src/random";
import type { Tactics } from "../src/tactics";

// Match seconds played per real second
export const SPEEDS = { Slow: 20, Normal: 60, Fast: 180 } as const;
export type Speed = keyof typeof SPEEDS;

const FRAME_MS = 100;

export interface MatchSetup {
  world: GameWorld;
  home: Club;
  away: Club;
  side: Side; // which side the player manages
  tactics: Tactics;
  seed: number;
}

// Runs one event-engine match on a timer. The engine mutates its state in
// place, so it lives in a ref and a counter tells React when to redraw.
export function useMatch(setup: MatchSetup) {
  const stateRef = useRef<MatchState | null>(null);
  if (!stateRef.current) {
    const { world, home, away, side, tactics, seed } = setup;
    stateRef.current = startEventMatch(world, home, away, seededRng(seed), { [side]: humanManager(tactics) });
  }
  const state = stateRef.current;

  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<Speed>("Normal");

  useEffect(() => {
    if (!running) return;
    const perFrame = Math.max(1, Math.round((SPEEDS[speed] * FRAME_MS) / 1000));
    const timer = setInterval(() => {
      for (let i = 0; i < perFrame && !isFullTime(state); i++) {
        stepEventMatch(state);
        // Stop for the team talk at half time
        if (state.phase === "half_time") {
          setRunning(false);
          break;
        }
      }
      if (isFullTime(state)) setRunning(false);
      redraw();
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [running, speed, state]);

  // The player's changes take effect straight away, not at the next manager check
  const changeTactics = (tactics: Tactics) => {
    applyTactics(state, setup.side, tactics);
    redraw();
  };

  // Substitutions are made at the next stoppage
  const substitute = (offId: string, onId: string) => {
    const ok = requestSub(state, setup.side, offId, onId);
    redraw();
    return ok;
  };

  return { state, running, setRunning, speed, setSpeed, changeTactics, substitute, finished: isFullTime(state) };
}

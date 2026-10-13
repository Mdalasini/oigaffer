import { useState } from "react";
import { spotSlot } from "../src/engine/formation";
import { PITCH_WIDTH } from "../src/engine/geometry";
import {
  FORMATIONS,
  isPlayPhase,
  MENTALITY_NAMES,
  shapeName,
  shapeOf,
  SPOTS,
  type FormationName,
  PLAY_PHASE_NAMES,
  PLAY_PHASE_POSSESSION,
  PLAY_PHASES,
  type Board as BoardName,
  type Mentality,
  type Possession,
  type Spot,
  moveSpot,
  type Tactics,
} from "../src/tactics";

const FORMATION_NAMES = Object.keys(FORMATIONS) as FormationName[];
const MENTALITIES: Mentality[] = [-2, -1, 0, 1, 2];
const ALL_SPOTS = Object.keys(SPOTS) as Spot[];
// Height of each board row in the sketch, keeper at the bottom
const SKETCH_ROW_Y = [70, 55, 46, 37, 26, 15];

const withKeeper = (formation: FormationName): Spot[] => ["GK", ...FORMATIONS[formation]];

// A chalk sketch of the shape: keeper at the bottom, attacking upwards
function Shape({ formation }: { formation: FormationName }) {
  const spots = withKeeper(formation);
  return (
    <svg viewBox="0 0 60 80" aria-hidden="true" className="shape">
      <rect x="2" y="2" width="56" height="76" rx="2" className="chalk" />
      <line x1="2" y1="40" x2="58" y2="40" className="chalk" />
      <rect x="18" y="66" width="24" height="12" className="chalk" />
      <rect x="18" y="2" width="24" height="12" className="chalk" />
      {spots.map((spot) => (
        <circle
          key={spot}
          cx={(60 * spotSlot(spot, spots).y) / PITCH_WIDTH}
          cy={SKETCH_ROW_Y[SPOTS[spot].row]}
          r="3.2"
          className="dot"
        />
      ))}
    </svg>
  );
}

type Names = Partial<Record<Spot, string>>;

// Every position on the tactics board, with the ones the shape uses lit up.
// Pick a position, then an empty one to move it there, or (with players named) another to swap them.
// Labels name who plays each position.
function Board({
  shape,
  names,
  labels = names,
  onMove,
}: {
  shape: readonly Spot[];
  names?: Names;
  labels?: Names;
  onMove: (from: Spot, to: Spot) => void;
}) {
  const [picked, setPicked] = useState<Spot | null>(null);
  const used = new Set<Spot>(["GK", ...shape]);
  const click = (spot: Spot) => {
    if (picked === null) {
      if (used.has(spot)) setPicked(spot);
      return;
    }
    if (spot !== picked) onMove(picked, spot);
    setPicked(null);
  };
  return (
    <>
      <div className="board">
        {ALL_SPOTS.map((spot) => (
          <button
            key={spot}
            className={used.has(spot) ? "spot used" : "spot"}
            aria-pressed={picked === spot}
            disabled={spot === "GK" || (picked === null && !used.has(spot))}
            style={{ gridRow: 6 - SPOTS[spot].row, gridColumn: SPOTS[spot].col + 1 }}
            onClick={() => click(spot)}
          >
            {spot}
            {used.has(spot) && labels?.[spot] && <span className="who">{labels[spot]}</span>}
          </button>
        ))}
      </div>
      <p className="note">
        {picked
          ? `Now pick an empty position for ${names?.[picked] ?? picked}${names ? ", or a teammate to swap with" : ""}.`
          : `Pick a position to move it${names ? " or swap players" : ""}.`}
      </p>
    </>
  );
}

export function TacticsPicker({
  tactics,
  onChange,
  onMove = (from, to, board) => onChange(moveSpot(tactics, from, to, board)),
  names,
  disabled = false,
}: {
  tactics: Tactics;
  onChange: (t: Tactics) => void;
  // Moves a position on one of the boards, or swaps the players in two positions
  onMove?: (from: Spot, to: Spot, board: BoardName) => void;
  // Who plays each position on a board
  names?: (board: BoardName) => Names;
  disabled?: boolean;
}) {
  const [board, setBoard] = useState<BoardName>("in");
  const possession: Possession = isPlayPhase(board) ? PLAY_PHASE_POSSESSION[board] : board;
  const boards: BoardName[] = [possession, ...PLAY_PHASES.filter((ph) => PLAY_PHASE_POSSESSION[ph] === possession)];
  const current = shapeName(tactics);
  // Before kickoff, the other boards show which in-possession position each one is paired with
  const inShape = shapeOf(tactics);
  const pairedWith: Names = Object.fromEntries(
    shapeOf(tactics, board).flatMap((s, i) => (s === inShape[i] ? [] : [[s, `from ${inShape[i]}`]])),
  );
  return (
    <div className="tactics">
      <fieldset className="formations" disabled={disabled}>
        <legend>Formation</legend>
        {FORMATION_NAMES.map((f) => (
          <button
            key={f}
            aria-pressed={f === current}
            onClick={() => onChange({ formation: f, mentality: tactics.mentality })}
          >
            <Shape formation={f} />
            <span>{f}</span>
          </button>
        ))}
      </fieldset>
      <fieldset className="positions" disabled={disabled}>
        <legend>Positions</legend>
        <div className="possession" role="group" aria-label="With or without the ball">
          {(["in", "out"] as const).map((p) => (
            <button key={p} aria-pressed={p === possession} onClick={() => setBoard(p)}>
              {p === "in" ? "With the ball" : "Without the ball"}
              <span className="shape-name">{shapeName(tactics, p)}</span>
            </button>
          ))}
        </div>
        <div className="phases" role="group" aria-label="Phase of play">
          {boards.map((b) => (
            <button
              key={b}
              aria-pressed={b === board}
              className={isPlayPhase(b) && tactics.phases?.[b] ? "own" : ""}
              onClick={() => setBoard(b)}
            >
              {isPlayPhase(b) ? PLAY_PHASE_NAMES[b] : "Every phase"}
              <span className="shape-name">{shapeName(tactics, b)}</span>
            </button>
          ))}
        </div>
        <Board
          key={board}
          shape={shapeOf(tactics, board)}
          names={names?.(board)}
          labels={names?.(board) ?? (board === "in" ? undefined : pairedWith)}
          onMove={(from, to) => onMove(from, to, board)}
        />
      </fieldset>
      <fieldset className="mentality" disabled={disabled}>
        <legend>Mentality</legend>
        <div className="scale">
          {MENTALITIES.map((m) => (
            <button
              key={m}
              className={m <= tactics.mentality ? "lit" : ""}
              aria-pressed={m === tactics.mentality}
              aria-label={MENTALITY_NAMES[m]}
              title={MENTALITY_NAMES[m]}
              onClick={() => onChange({ ...tactics, mentality: m })}
            />
          ))}
        </div>
        <div className="scale-ends">
          <span>Sit deep</span>
          <strong>{MENTALITY_NAMES[tactics.mentality]}</strong>
          <span>Go for it</span>
        </div>
      </fieldset>
    </div>
  );
}

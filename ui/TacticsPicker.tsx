import { spotSlot } from "../src/engine/formation";
import { PITCH_WIDTH } from "../src/engine/geometry";
import { FORMATIONS, MENTALITY_NAMES, SPOTS, type FormationName, type Mentality, type Spot, type Tactics } from "../src/tactics";

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

// Every position on the tactics board, with the ones this formation uses lit up
function Board({ formation }: { formation: FormationName }) {
  const used = new Set(withKeeper(formation));
  return (
    <div className="board" role="img" aria-label={`${formation}: ${[...used].join(", ")}`}>
      {ALL_SPOTS.map((spot) => (
        <span
          key={spot}
          className={used.has(spot) ? "spot used" : "spot"}
          style={{ gridRow: 6 - SPOTS[spot].row, gridColumn: SPOTS[spot].col + 1 }}
        >
          {spot}
        </span>
      ))}
    </div>
  );
}

export function TacticsPicker({
  tactics,
  onChange,
  disabled = false,
}: {
  tactics: Tactics;
  onChange: (t: Tactics) => void;
  disabled?: boolean;
}) {
  return (
    <div className="tactics">
      <fieldset className="formations" disabled={disabled}>
        <legend>Formation</legend>
        {FORMATION_NAMES.map((f) => (
          <button
            key={f}
            aria-pressed={f === tactics.formation}
            onClick={() => onChange({ ...tactics, formation: f })}
          >
            <Shape formation={f} />
            <span>{f}</span>
          </button>
        ))}
        <Board formation={tactics.formation} />
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

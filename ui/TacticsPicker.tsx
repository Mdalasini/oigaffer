import { FORMATIONS, MENTALITY_NAMES, type FormationName, type Mentality, type Tactics } from "../src/tactics";

const FORMATION_NAMES = Object.keys(FORMATIONS) as FormationName[];
const MENTALITIES: Mentality[] = [-2, -1, 0, 1, 2];

// A chalk sketch of the shape: keeper at the bottom, attacking upwards
function Shape({ formation }: { formation: FormationName }) {
  const lines = [1, FORMATIONS[formation].DEF, FORMATIONS[formation].MID, FORMATIONS[formation].FWD];
  const rows = [70, 52, 34, 14];
  return (
    <svg viewBox="0 0 60 80" aria-hidden="true" className="shape">
      <rect x="2" y="2" width="56" height="76" rx="2" className="chalk" />
      <line x1="2" y1="40" x2="58" y2="40" className="chalk" />
      <rect x="18" y="66" width="24" height="12" className="chalk" />
      <rect x="18" y="2" width="24" height="12" className="chalk" />
      {lines.map((count, line) =>
        Array.from({ length: count }, (_, i) => (
          <circle key={`${line}-${i}`} cx={(60 * (i + 1)) / (count + 1)} cy={rows[line]} r="3.2" className="dot" />
        )),
      )}
    </svg>
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

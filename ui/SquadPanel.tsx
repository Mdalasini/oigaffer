import { useState } from "react";
import type { Names } from "../src/commentary";
import { bench, subsLeft } from "../src/engine/lineup";
import type { MatchState, Side } from "../src/engine/state";
import type { Position } from "../src/model";

const ROLE_ORDER: Position[] = ["GK", "DEF", "MID", "FWD"];

// Who's on, how tired they are, and who's on the bench. Pick a player, then their replacement.
export function SquadPanel({
  state,
  side,
  names,
  onSubstitute,
  disabled,
}: {
  state: MatchState;
  side: Side;
  names: Names;
  onSubstitute: (offId: string, onId: string) => boolean;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const pending = state.teams[side].pendingSubs;
  const left = subsLeft(state, side) - pending.length;
  const onPitch = state.players
    .filter((p) => p.side === side)
    .sort((a, b) => ROLE_ORDER.indexOf(a.position) - ROLE_ORDER.indexOf(b.position) || a.slot.y - b.slot.y);
  const goingOff = new Set(pending.map((s) => s.offId));
  const comingOn = new Set(pending.map((s) => s.onId));
  const sentOff = state.offPitch.filter((o) => o.side === side && o.reason === "sent_off");

  const choose = (onId: string) => {
    if (selected && onSubstitute(selected, onId)) setSelected(null);
  };

  return (
    <section className="squad">
      <h2>Squad</h2>
      <p className="note">
        {left === 0
          ? "No changes left."
          : selected
            ? `Now pick who replaces ${names.player(selected)}.`
            : `${left} change${left === 1 ? "" : "s"} left. Pick a player to take off.`}
      </p>
      <ol className="players">
        {onPitch.map((p) => (
          <li key={p.id}>
            <button
              aria-pressed={selected === p.id}
              disabled={disabled || left === 0 || goingOff.has(p.id)}
              onClick={() => setSelected(selected === p.id ? null : p.id)}
            >
              <span className="role">{p.position}</span>
              <span className="who">
                {names.player(p.id)}
                {p.yellow && <span className="booking" aria-label="booked" />}
              </span>
              <span className="energy" aria-label={`${Math.round(p.energy * 100)}% energy`}>
                <span style={{ width: `${p.energy * 100}%` }} />
              </span>
            </button>
          </li>
        ))}
        {sentOff.map((o) => (
          <li key={o.id} className="off">
            <span className="role">{o.natural}</span>
            <span className="who">{names.player(o.id)} (sent off)</span>
          </li>
        ))}
      </ol>

      <h3>Bench</h3>
      <ol className="players">
        {bench(state, side).map((b) => (
          <li key={b.id}>
            <button disabled={disabled || !selected || comingOn.has(b.id)} onClick={() => choose(b.id)}>
              <span className="role">{b.natural}</span>
              <span className="who">{names.player(b.id)}</span>
            </button>
          </li>
        ))}
      </ol>
      {pending.length > 0 && (
        <p className="note">
          At the next stoppage:{" "}
          {pending.map((s) => `${names.player(s.onId)} on for ${names.player(s.offId)}`).join(", ")}.
        </p>
      )}
    </section>
  );
}

import { commentary, minuteLabel, type CommentaryLine, type Names } from "../src/commentary";
import { opponent, type Side } from "../src/engine/state";
import { teamStats, type TeamStats } from "../src/stats";
import { MENTALITY_NAMES, shapeName, type Possession, type Spot } from "../src/tactics";
import { SquadPanel } from "./SquadPanel";
import { TacticsPicker } from "./TacticsPicker";
import { SPEEDS, useMatch, type MatchSetup, type Speed } from "./useMatch";

// label, value, how to show it
const STAT_ROWS: [string, (s: TeamStats) => number, (n: number) => string][] = [
  ["Possession", (s) => s.possession, (n) => `${Math.round(100 * n)}%`],
  ["Expected goals", (s) => s.xg, (n) => n.toFixed(2)],
  ["Shots", (s) => s.shots, String],
  ["On target", (s) => s.onTarget, String],
  ["Passes", (s) => s.passes, String],
  ["Pass accuracy", (s) => s.passAccuracy, (n) => `${Math.round(100 * n)}%`],
  ["Tackles won", (s) => s.tacklesWon, String],
  ["Interceptions", (s) => s.interceptions, String],
  ["Through balls", (s) => s.throughBalls, String],
  ["Crosses", (s) => s.crosses, String],
  ["Corners", (s) => s.corners, String],
  ["Fouls", (s) => s.fouls, String],
  ["Offsides", (s) => s.offsides, String],
  ["Yellow cards", (s) => s.yellows, String],
  ["Red cards", (s) => s.reds, String],
];

export function MatchScreen({ setup, onExit }: { setup: MatchSetup; onExit: () => void }) {
  const { state, running, setRunning, speed, setSpeed, changeTactics, movePosition, substitute, finished } = useMatch(setup);
  const { world, home, away, side: mySide } = setup;

  const names: Names = {
    club: (s) => (s === "home" ? home.name : away.name),
    player: (id) => world.players[id]?.name ?? id,
  };
  const feed = commentary(state.events, names).reverse();
  const stats = { home: teamStats(state.events, "home"), away: teamStats(state.events, "away") };
  const theirs = state.teams[opponent(mySide)].tactics;
  const surname = (id: string) => names.player(id).split(" ").at(-1)!;
  const mine = state.players.filter((p) => p.side === mySide);
  const atSpot: Record<Possession, Partial<Record<Spot, string>>> = {
    in: Object.fromEntries(mine.map((p) => [p.spot, surname(p.id)])),
    out: Object.fromEntries(mine.map((p) => [p.outSpot, surname(p.id)])),
  };
  const whose = (side: Side) => (side === mySide ? "us" : "them");

  const clock = finished ? "FT" : state.phase === "half_time" ? "HT" : minuteLabel(state.period, state.clock);
  const playLabel = running
    ? "Pause"
    : state.time === 0
      ? "Kick off"
      : state.phase === "half_time"
        ? "Start second half"
        : "Resume";

  return (
    <main className="match">
      <header className="scoreboard">
        <div className={`club ${whose("home")}`}>
          <span className="name">{home.name}</span>
          <span className="xg">xG {stats.home.xg.toFixed(2)}</span>
        </div>
        <div className="result">
          <span className="score">
            {state.score.home}
            <span className="dash">–</span>
            {state.score.away}
          </span>
          <span className="clock">{clock}</span>
        </div>
        <div className={`club ${whose("away")}`}>
          <span className="name">{away.name}</span>
          <span className="xg">xG {stats.away.xg.toFixed(2)}</span>
        </div>
      </header>

      <section className="feed" aria-live="polite">
        <ol>
          {feed.map((line, i) => (
            <FeedLine key={feed.length - i} line={line} whose={line.side ? whose(line.side) : "neutral"} />
          ))}
        </ol>
        {state.time === 0 && <p className="empty">Set your shape, then kick off when you're ready.</p>}
      </section>

      <aside className="dugout">
        <div className="clock-controls">
          {finished ? (
            <button className="go" onClick={onExit}>
              Play another match
            </button>
          ) : (
            <button className="go" onClick={() => setRunning(!running)}>
              {playLabel}
            </button>
          )}
          <div className="speeds" role="group" aria-label="Match speed">
            {(Object.keys(SPEEDS) as Speed[]).map((s) => (
              <button key={s} aria-pressed={s === speed} onClick={() => setSpeed(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <section>
          <h2>Your tactics</h2>
          <TacticsPicker
            tactics={state.teams[mySide].tactics}
            onChange={changeTactics}
            onMove={movePosition}
            names={atSpot}
            disabled={finished}
          />
          <p className="note">
            {names.club(opponent(mySide))} are playing {shapeName(theirs)}{theirs.outOfPossession ? ` (${shapeName(theirs, "out")} without the ball)` : ""}, {MENTALITY_NAMES[theirs.mentality]}.
          </p>
        </section>

        <SquadPanel state={state} side={mySide} names={names} onSubstitute={substitute} disabled={finished} />

        <section>
          <h2>Stats</h2>
          <dl className="stats">
            {STAT_ROWS.map(([label, value, show]) => {
              const h = value(stats.home);
              const a = value(stats.away);
              const share = h + a === 0 ? 0.5 : h / (h + a);
              return (
                <div key={label} className="stat">
                  <dt>{label}</dt>
                  <dd className={`num ${whose("home")}`}>{show(h)}</dd>
                  <dd className={`bar ${h + a === 0 ? "none" : ""}`} aria-hidden="true">
                    <span className={whose("home")} style={{ flexGrow: share }} />
                    <span className={whose("away")} style={{ flexGrow: 1 - share }} />
                  </dd>
                  <dd className={`num ${whose("away")}`}>{show(a)}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      </aside>
    </main>
  );
}

function FeedLine({ line, whose }: { line: CommentaryLine; whose: string }) {
  return (
    <li className={`${line.kind} ${whose}`}>
      <span className="minute">{minuteLabel(line.period, line.clock)}</span>
      <span className="text">{line.text}</span>
    </li>
  );
}

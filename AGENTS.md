# oigaffer

A football-manager simulator in the style of Football Manager. TypeScript on Bun, no runtime dependencies, the whole game world held in memory.

## Commands

```bash
bun test                      # all tests
bun run typecheck             # tsc --noEmit (strict, noUncheckedIndexedAccess)
bun run season [seed] [--events]   # play a season and print the table (Poisson engine unless --events)
bun run watch [seed]          # play one event-engine match: shots, tactical changes, stats
bun run calibrate [seasons]   # compare the event engine against the Poisson engine
bun run ui                    # Vite dev server for the browser UI (http://localhost:5173)
bun run ui:build              # production build into ui/dist
```

Run `bun test` and `bun run typecheck` before every commit.

## Layout

```
src/
  model.ts        Player, Club, GameWorld (the in-memory save) — keep this small
  strength.ts     Derived attacking/defending ratings and club strength
  random.ts       Seeded RNG (mulberry32) and Poisson sampler
  seed.ts         Generates clubs with an 18-player squad from a club "quality"
  squad.ts        pickEleven (best eleven for a formation) and lineRating
  match.ts        Poisson quick-sim engine and the MatchEngine/MatchResult types
  fixtures.ts     Double round robin (circle method)
  table.ts        League table
  season.ts       playSeason(world, rng, engine)
  tactics.ts      Mentality, formations, assignRoles (moving players between lines)
  manager.ts      Manager interface, the default decision-tree manager, humanManager
  commentary.ts   Turns match events into commentary lines (only the moments a manager reacts to)
  stats.ts        Per-team box-score stats counted from the event log
  engine/         Event-based match engine (see below)
  calibrate.ts, main.ts, watch.ts   CLI entry points
  test-helpers.ts Shared fixtures: player(), squad(), strongVsWeak()
ui/               Vite + React app; imports the game straight from src/
  App.tsx         Setup screen: pick clubs and starting tactics
  MatchScreen.tsx Scoreboard, commentary feed, manager controls, stats
  SquadPanel.tsx  Players on the pitch with energy and bookings, the bench, substitutions
  useMatch.ts     Runs a match on a timer with startEventMatch/stepEventMatch
  TacticsPicker.tsx, styles.css
```

## Domain model

- Players have six attributes on a 1–20 scale: `passing`, `shooting`, `dribbling`, `tackling`, `goalkeeping` and `stamina` (how slowly they tire). `attackingRating`/`defendingRating` in `strength.ts` derive the summary values the Poisson engine uses.
- `Player.position` is the natural position. In a match, `MatchPlayer.position` is the role in the current formation and can change.
- `Club.playerIds` is the whole squad (18 from the seed: 2 GK, 6 DEF, 6 MID, 4 FWD, with reserves a notch weaker). `pickEleven` chooses the starters; `clubStrength` rates that eleven. There are no contracts or finances yet. The user explicitly wants the model kept minimal, so add fields only when a feature needs them.

## Two match engines

Both implement `MatchEngine` and return a `MatchResult`, so `playSeason` can use either.

- **Poisson (`src/match.ts`)**: xG = `1.35 × attack ÷ opponent defence`, goals sampled from Poisson. It is fast, and it is the calibration target.
- **Event engine (`src/engine/`)**: one-second ticks on a continuous 105×68 m pitch. It is structured after Millington's *AI for Games*:
  - **Strategy**: managers (`manager.ts`) set formation and mentality and make substitutions; `formation.ts` turns tactics into slots that slide with the ball (pushed up and stretched wide in possession, narrow without it).
  - **Decision making**: `decide.ts` scores every option for the ball carrier (a pass per teammate, through balls, crosses, shoot, dribble, clear) in expected-goal units, and picks one by softmax. A restart limits the options (a throw-in can only be passed, a corner is crossed, a penalty is shot), and passers ignore teammates who are obviously offside.
  - **Movement**: `movement.ts` uses kinematic steering (arrive, pursue, interpose). It covers pressing, goal-side marking, cover, the offside line, loose balls, corner positions and standing back from restarts. Running drains energy.
  - **Outcomes**: `resolve.ts` rolls results from attributes, separately from the decision: passes, crosses (block, delivery, keeper claim, aerial duel, header), shots, dribbles, tackles and the fouls that come from them. Every outcome is emitted as a `MatchEvent`; the score is derived from the events.
  - **Ball flight**: `flight.ts`. A struck ball (pass, through ball, cross, shot, clearance) flies at a realistic speed and arc (`BALL_SPEED`, `BALL_PEAK`) and lands on a later tick. The outcome is still rolled when the ball is struck, but it is stored on `ball.flight` as plain data (an `Arrival` plus the events to emit) and applied on landing, so match state stays serialisable. While the ball is in the air nobody owns it, tackles it or picks it up. The intended receiver runs to the landing spot, and if they haven't reached it the ball drops loose with no completed pass recorded. A header is rolled when the cross arrives. Renderers read `ball.height` and call `sampleFlight(flight, tick)` with fractional ticks for smooth motion.
  - **Rules**: `referee.ts` judges fouls (advantage, free kick or penalty), cards (yellow, second yellow, straight red, last-man fouls) and offside; the referee has a seeded strictness. `restarts.ts` decides what happens when the ball goes out (throw-in, corner, goal kick) and sets up free kicks and penalties. A restart puts the ball on the spot and the taker walks to it; the ball stays dead (`ballDead`) until the setup time (seeded, realistic durations) has passed *and* the taker is at the ball, and nobody may challenge until the restart is taken. Players reach kickoff, penalty, corner and wall positions by moving, never by teleporting (only the two half-starting kickoffs place players), so a renderer can draw every tick. `lineup.ts` handles tactics changes, substitutions (five, made only at a dead ball or half time), injuries and sending-offs; a side down to ten re-fits its shape and finds an emergency keeper. `fatigue.ts` lowers attributes and speed as energy drops.
  - `valuation.ts` holds xG, possession value, pass risk, race, cross, free-kick and penalty estimates; `state.ts` holds the match state and sensing queries; `constants.ts` holds every tuning knob.

The match clock runs in two periods. `state.clock` is match time (0–2700 s first half, 2700–5400 s second, then added time); `state.time` counts every tick and keeps events in order. At 45' and 90' the added time is announced from the half's stoppages (goals, subs, cards, injuries, penalties), and `state.phase` moves through `first_half`, `half_time`, `second_half` and `full_time` (or `abandoned` if a side drops below seven players, which awards the match 3-0). Stoppages during added time extend it, and a penalty awarded at the death is always taken before the whistle. Show minutes with `minuteLabel(period, clock)` (for example 45+2').

`simulateEventMatch` plays a whole match in one go. The UI drives the same loop one second at a time with `startEventMatch` and `stepEventMatch`, applies the player's tactics immediately with `applyTactics`, and queues their substitutions with `requestSub`. The player's side uses `humanManager`, which never changes tactics or makes subs on its own. Injured players are replaced like-for-like automatically for both sides. Keep the two paths identical: a test checks that stepping and simulating produce the same events.

Each team works in its own **team frame**, attacking towards x = 105. Convert with `toTeamFrame`/`fromTeamFrame` instead of special-casing home and away.

## Determinism

All randomness goes through an injected `Rng`. Never call `Math.random()` inside the engine or season code. The same seed must replay the same match or season, and tests rely on that.

## Calibration and balance (important)

The event engine's behaviour is emergent, and the constants interact strongly. After **any** change to `src/engine/`:

1. Run `bun run calibrate 5` (or 6 for a steadier read). The event engine should stay close to the Poisson engine: about 2.5–2.9 goals a game, about 25% draws, favourites winning about 55%, and a strength→GD correlation of about 0.45–0.5. Per-team stats should stay plausible: about 13 shots, about 360 completed passes at about 80% completion, roughly 8–10 fouls, 1–2 yellows, about 2 offsides, about 0.15 penalties, 3–5 subs, and added time of about 2 + 4 minutes.
2. If the change touches shape, pressing, marking, valuation or anything that mentality and formation feed into, re-check tactical balance. Play the same two teams (`strongVsWeak(12, 12)`) with `fixedManager` setups against a balanced 4-4-2 for 150 or more matches each. Use at least that many, because smaller samples are dominated by noise. Defensive settings should lower goals both ways and attacking settings should raise them. No setting should dominate.

Lessons from previous tuning:
- Territory used to be everything. When pushing up was free, the most attacking setting won every match. The costs that now balance it are counter-attacks, through balls into space behind a line, marking and cover. Don't remove them without re-checking balance.
- Formation anchors need per-line depth limits (`LINE_RANGE`). Without them, a pinned-back defence collapses onto its own goal line.
- Tie-breaks must not favour list order, because that once gave home teams a 69% win rate. Contested loose balls are resolved randomly.
- Real-world figures make good sanity anchors: the xG curve is about 0.45 at 6 m, 0.22 at 11 m and 0.06 at 20 m.
- Every attribute-driven roll sharpens the gap between strong and weak teams. When adding one (crosses and aerial duels were the latest), check the favourite win rate and correlation, and keep the skill coefficients modest.
- Fouls in the box need to be rarer than elsewhere (`BOX_FOUL_FACTOR`); otherwise penalties swamp the scoring.
- Clearances must not be aimed over the opponent's goal line (`CLEAR_MAX_DEPTH`); otherwise goal kicks pile up.
- A defensive mentality that only means "risk-averse passing" makes teams hoard the ball in their own half and concede more. Defensive teams also play more directly (`MENTALITY_DIRECT`) and narrower (`MENTALITY_WIDTH`). Shifting the line with mentality (tried again on this branch) only rewards territory, so don't.
- Restart timing is part of calibration: realistic dead-ball durations cut playing time and goals, which was offset by the xG scale (`XG_MAX`).
- Re-run the broad engine audit with `pi-workflow run .pi/workflows/engine-audit.js --cwd <scratch worktree>` (eight read-only auditors that write probes under `probes/`). Run it in a separate git worktree, never the main checkout.
- Ball flight takes about a third of live play, so carriers have fewer seconds on the ball. That cut tackles and fouls, and was offset by raising `TACKLE_ATTEMPT` from 0.10 to 0.17. Completed passes fell from about 590 to about 360 a team, which is closer to real football.
- Known open issues for animation: receivers stand still while controlling the ball, and players have no velocity or facing and can overlap. Ball-in-play time is about 80 minutes against a real 55–60. Throw-ins (about 7 a team, real about 20) come almost entirely from passes going astray.
- Prototypes for first touch and pacing, and for player steering, are described in `.pi/workflows/ball-flight-explore.js`, which can be re-run in scratch worktrees.
- Known open imbalances: 4-3-3 is the strongest formation (about 1.9 points a game against a balanced 4-4-2's 1.4), and back fives and 4-5-1 are the weakest (about 1.1). Very defensive costs about 0.35 points a game but lowers goals both ways. Corners (about 2 a team) and crosses (about 4) are well below real football.

## UI

- The UI only reads engine state and calls engine functions. Game rules stay in `src/`, so they are tested and reusable from the CLI.
- The engine mutates `MatchState` in place. `useMatch` keeps it in a ref and bumps a counter to redraw.
- Visual direction is a floodlit match night: grass green, chalk white, amber for the player's team and sky blue for the opponent. Big Shoulders Display is used for the scoreboard and headings, and Atkinson Hyperlegible for everything else. Colours are CSS variables at the top of `styles.css`; keep new UI within that palette.

## Code style

- Match the surrounding code. Use small modules, plain functions and interfaces, with no classes.
- Comments explain *why* or describe football behaviour, not what the next line does.
- Put tuning numbers in `engine/constants.ts` with a short comment and units, never inline.
- In `ui/`, use function components and hooks. Keep logic that doesn't need React in `src/`.
- Tests live next to the code as `*.test.ts` and use `bun:test`. Use `test-helpers.ts` fixtures and seeded RNGs. Statistical tests should use enough matches and loose thresholds so they don't flake, and pass `SLOW_TEST` as the timeout when they play many full matches.

## Git workflow

- Never commit to `main` directly. Branch as `feat/<name>` for features and `docs/<name>` for docs.
- Open a PR against `main` with `gh pr create`, then merge with `gh pr merge --merge --delete-branch`. Only do this when asked.
- PR descriptions summarise what changed and include calibration results when the engine changed.

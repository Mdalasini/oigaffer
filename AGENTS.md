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
  seed.ts         Generates clubs with a 4-4-2 eleven from a club "quality"
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
  useMatch.ts     Runs a match on a timer with startEventMatch/stepEventMatch
  TacticsPicker.tsx, styles.css
```

## Domain model

- Players have five attributes on a 1–20 scale: `passing`, `shooting`, `dribbling`, `tackling`, `goalkeeping`. `attackingRating`/`defendingRating` in `strength.ts` derive the summary values the Poisson engine uses.
- `Player.position` is the natural position. In a match, `MatchPlayer.position` is the role in the current formation and can change.
- Squads are exactly eleven players. There are no subs, contracts, injuries or finances yet. The user explicitly wants the model kept minimal, so add fields only when a feature needs them.

## Two match engines

Both implement `MatchEngine` and return a `MatchResult`, so `playSeason` can use either.

- **Poisson (`src/match.ts`)**: xG = `1.35 × attack ÷ opponent defence`, goals sampled from Poisson. It is fast, and it is the calibration target.
- **Event engine (`src/engine/`)**: one-second ticks on a continuous 105×68 m pitch. It is structured after Millington's *AI for Games*:
  - **Strategy**: managers (`manager.ts`) set formation and mentality; `formation.ts` turns that into slots that slide with the ball.
  - **Decision making**: `decide.ts` scores every option for the ball carrier (a pass per teammate, through balls, shoot, dribble, clear) in expected-goal units, and picks one by softmax.
  - **Movement**: `movement.ts` uses kinematic steering (arrive, pursue, interpose). It covers pressing, goal-side marking, cover, the offside line and loose balls.
  - **Outcomes**: `resolve.ts` rolls results from attributes, separately from the decision. Every outcome is emitted as a `MatchEvent`; the score is derived from the events.
  - `valuation.ts` holds xG, possession value, pass risk and race estimates; `state.ts` holds the match state and sensing queries; `constants.ts` holds every tuning knob.

`simulateEventMatch` plays a whole match in one go. The UI drives the same loop one second at a time with `startEventMatch` and `stepEventMatch`, and applies the player's changes immediately with `applyTactics`. The player's side uses `humanManager`, which never changes tactics on its own. Keep the two paths identical: a test checks that stepping and simulating produce the same events.

Each team works in its own **team frame**, attacking towards x = 105. Convert with `toTeamFrame`/`fromTeamFrame` instead of special-casing home and away.

## Determinism

All randomness goes through an injected `Rng`. Never call `Math.random()` inside the engine or season code. The same seed must replay the same match or season, and tests rely on that.

## Calibration and balance (important)

The event engine's behaviour is emergent, and the constants interact strongly. After **any** change to `src/engine/`:

1. Run `bun run calibrate 5`. The event engine should stay close to the Poisson engine: about 2.5–2.9 goals a game, about 25% draws, favourites winning about 55%, and a strength→GD correlation of about 0.45–0.5. Per-team stats should stay plausible: about 13 shots, about 80% pass completion.
2. If the change touches shape, pressing, marking, valuation or anything that mentality and formation feed into, re-check tactical balance. Play the same two teams (`strongVsWeak(12, 12)`) with `fixedManager` setups against a balanced 4-4-2 for 150 or more matches each. Use at least that many, because smaller samples are dominated by noise. Defensive settings should lower goals both ways and attacking settings should raise them. No setting should dominate.

Lessons from previous tuning:
- Territory used to be everything. When pushing up was free, the most attacking setting won every match. The costs that now balance it are counter-attacks, through balls into space behind a line, marking and cover. Don't remove them without re-checking balance.
- Formation anchors need per-line depth limits (`LINE_RANGE`). Without them, a pinned-back defence collapses onto its own goal line.
- Tie-breaks must not favour list order, because that once gave home teams a 69% win rate. Contested loose balls are resolved randomly.
- Real-world figures make good sanity anchors: the xG curve is about 0.45 at 6 m, 0.22 at 11 m and 0.06 at 20 m.
- Known open imbalances: attacking mentality is worth about +0.3 points a game, one-striker formations are net negative, and tackles and interceptions run higher than in real football.

## UI

- The UI only reads engine state and calls engine functions. Game rules stay in `src/`, so they are tested and reusable from the CLI.
- The engine mutates `MatchState` in place. `useMatch` keeps it in a ref and bumps a counter to redraw.
- Visual direction is a floodlit match night: grass green, chalk white, amber for the player's team and sky blue for the opponent. Big Shoulders Display is used for the scoreboard and headings, and Atkinson Hyperlegible for everything else. Colours are CSS variables at the top of `styles.css`; keep new UI within that palette.

## Code style

- Match the surrounding code. Use small modules, plain functions and interfaces, with no classes.
- Comments explain *why* or describe football behaviour, not what the next line does.
- Put tuning numbers in `engine/constants.ts` with a short comment and units, never inline.
- In `ui/`, use function components and hooks. Keep logic that doesn't need React in `src/`.
- Tests live next to the code as `*.test.ts` and use `bun:test`. Use `test-helpers.ts` fixtures and seeded RNGs. Statistical tests should use enough matches and loose thresholds so they don't flake.

## Git workflow

- Never commit to `main` directly. Branch as `feat/<name>` for features and `docs/<name>` for docs.
- Open a PR against `main` with `gh pr create`, then merge with `gh pr merge --merge --delete-branch`. Only do this when asked.
- PR descriptions summarise what changed and include calibration results when the engine changed.

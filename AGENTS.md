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
  tactics.ts      Mentality, board positions (SPOTS), formations, assignRoles (moving players between lines)
  manager.ts      Manager interface, the default decision-tree manager, humanManager
  commentary.ts   Turns match events into commentary lines (only the moments a manager reacts to)
  stats.ts        Per-team box-score stats counted from the event log
  engine/         Event-based match engine (see below)
  analysis/       Match recordings and analyst views for checking player behaviour (see below)
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

- Players have ten attributes on a 1–20 scale. Six skills: `passing`, `shooting`, `dribbling`, `tackling`, `goalkeeping` and `stamina` (how slowly they tire). Four physicals: `pace` (top running speed), `acceleration` (how quickly they reach top speed), `jumping` (reach in the air) and `strength` (holding off and winning physical challenges). 10 is neutral for the physicals, and the test fixture `player()` sets them to 10. The seed draws the physicals in a second pass after all squads exist, from a positional profile (FWD fastest, DEF best in the air and strongest, MID the weakest in both), with only a loose link to club quality (`PHYSICAL_QUALITY`), so they add variety without widening the gap between strong and weak sides. `attackingRating`/`defendingRating` in `strength.ts` derive the summary values the Poisson engine uses. No engine code reads the physicals yet.
- `Player.position` is the natural line (GK/DEF/MID/FWD). In a match, `MatchPlayer.position` is the line in the current formation and can change, and `MatchPlayer.spot` is the position on the tactics board (LB, CDM, LW…).
- The tactics board (`SPOTS` in `tactics.ts`) has a keeper and 23 outfield positions in rows (defence, wing-backs/holding midfield, midfield, attacking midfield/wingers, forwards) and five columns. Each position belongs to a line, which is what the engine's behaviour keys on: wing-backs are DEF, wingers are FWD. A formation is a list of ten positions; `arrangeSide` gives each line's players that line's positions in left-to-right order, and `spotSlot` turns a position into a slot. A manager can rearrange a preset on the board: `moveSpot` moves a position and the player in it (which can change their line), and `swapPlayers` trades two players' positions. The result is stored as `Tactics.shape` (read it with `shapeOf`, name it with `shapeName`, which counts a custom shape row by row, such as 4-2-3-1). `Tactics.outOfPossession` is a second shape in the same order: whoever plays `shape[i]` drops to `outOfPossession[i]` when the other side has the ball (wingers to LM/RM, say). Phases of play refine both: `Tactics.phases` can give any of build-up, middle third and final third (with the ball) or high, mid and low block (without it) a shape of its own, again in the same order; a phase without one uses the in- or out-of-possession shape (`shapeOf(t, board)`, `pairedSpot`). The phase comes from which third the ball is in, in the side's team frame (`phaseAt`, `BUILD_UP_END`, `FINAL_THIRD_START`). `arrangeSide` gives every player a `Role` (position, line and slot) per phase in `MatchPlayer.roles`; `anchor` builds on the current phase's role, and anything keyed on a defending player's line (which lines press, cover and retreat fast) uses `roleOf(state, p, false)`. A phase that uses the side's own shape copies the player's `spot`, `position` and `slot`. Once a side has a custom shape, players keep their positions through later refits (red cards, injuries without a sub); preset sides re-sort each line left to right as before, so the default manager plays exactly as it did.
- `Club.playerIds` is the whole squad (18 from the seed: 2 GK, 6 DEF, 6 MID, 4 FWD, with reserves a notch weaker). `pickEleven` chooses the starters; `clubStrength` rates that eleven. There are no contracts or finances yet. The user explicitly wants the model kept minimal, so add fields only when a feature needs them.

## Two match engines

Both implement `MatchEngine` and return a `MatchResult`, so `playSeason` can use either.

- **Poisson (`src/match.ts`)**: xG = `1.35 × attack ÷ opponent defence`, goals sampled from Poisson. It is fast, and it is the calibration target.
- **Event engine (`src/engine/`)**: one-second ticks on a continuous 105×68 m pitch. It is structured after Millington's *AI for Games*:
  - **Strategy**: managers (`manager.ts`) set formation and mentality and make substitutions; `formation.ts` turns tactics into slots that slide with the ball (pushed up and stretched wide in possession, narrow without it).
  - **Decision making**: `decide.ts` scores every option for the ball carrier (a pass per teammate, through balls, crosses, shoot, dribble, clear) in expected-goal units, and picks one by softmax. A restart limits the options (a throw-in can only be passed, a corner is crossed, a penalty is shot), and passers ignore teammates who are obviously offside.
  - **Movement**: `movement.ts` decides where each player is going (arrive, pursue, interpose), and `steering.ts` gets them there like a footballer: every player has a velocity and a facing, accelerates at about 4 m/s² (8 for pressers and markers, 6 for retreating defenders), brakes at 6, turns at a limited rate, keeps about a metre from others, and moves in two half-second substeps. It covers pressing, goal-side marking, cover, the offside line, loose balls, corner positions and standing back from restarts. Running drains energy. Pace scales a player's top speed (`PACE_EFFECT`) and acceleration their acceleration (`ACCEL_EFFECT`), and `raceWinChance` uses pace.
  - **Outcomes**: `resolve.ts` rolls results from attributes, separately from the decision: passes, crosses (block, delivery, keeper claim, aerial duel, header), shots, dribbles, tackles and the fouls that come from them. Jumping and strength decide aerial duels alongside the heading proxies (`AERIAL_JUMP`, `AERIAL_STRENGTH`), strength helps win tackles (`TACKLE_STRENGTH`) and shields a first touch from the presser (`SHIELD_STRENGTH`). Every outcome is emitted as a `MatchEvent`; the score is derived from the events.
  - **Ball flight**: `flight.ts`. A struck ball (pass, through ball, cross, shot, clearance) flies at a realistic speed and arc (`BALL_SPEED`, `BALL_PEAK`) and lands on a later tick. The outcome is still rolled when the ball is struck, but it is stored on `ball.flight` as plain data (an `Arrival` plus the events to emit) and applied on landing, so match state stays serialisable. While the ball is in the air nobody owns it, tackles it or picks it up. The intended receiver runs to the landing spot, and if they haven't reached it the ball drops loose with no completed pass recorded. A header is rolled when the cross arrives. Renderers read `ball.height` and call `sampleFlight(flight, tick)` with fractional ticks for smooth motion.
  - **Rules**: `referee.ts` judges fouls (advantage, free kick or penalty), cards (yellow, second yellow, straight red, last-man fouls) and offside; the referee has a seeded strictness. `restarts.ts` decides what happens when the ball goes out (throw-in, corner, goal kick) and sets up free kicks and penalties. A restart puts the ball on the spot and the taker walks to it; the ball stays dead (`ballDead`) until the setup time (seeded, realistic durations) has passed *and* the taker is at the ball, and nobody may challenge until the restart is taken. Players reach kickoff, penalty, corner and wall positions by moving, never by teleporting (only the two half-starting kickoffs place players), so a renderer can draw every tick. `lineup.ts` handles tactics changes, substitutions (five, made only at a dead ball or half time), injuries and sending-offs; a side down to ten re-fits its shape and finds an emergency keeper. `fatigue.ts` lowers attributes and speed as energy drops.
  - `debug.ts` defines the optional `state.debug` hook: per-player intents from `movement.ts` and scored options from `decide.ts`. It is for throwaway probes only. The engine never reads it back, nothing in `src/` sets it, and a new movement behaviour should add its own `Intent`.
  - `valuation.ts` holds xG, possession value, pass risk, race, cross, free-kick and penalty estimates; `state.ts` holds the match state and sensing queries; `constants.ts` holds every tuning knob.

The match clock runs in two periods. `state.clock` is match time (0–2700 s first half, 2700–5400 s second, then added time); `state.time` counts every tick and keeps events in order. At 45' and 90' the added time is announced from the half's stoppages (goals, subs, cards, injuries, penalties), and `state.phase` moves through `first_half`, `half_time`, `second_half` and `full_time` (or `abandoned` if a side drops below seven players, which awards the match 3-0). Stoppages during added time extend it, and a penalty awarded at the death is always taken before the whistle. Show minutes with `minuteLabel(period, clock)` (for example 45+2').

`simulateEventMatch` plays a whole match in one go. The UI drives the same loop one second at a time with `startEventMatch` and `stepEventMatch`, applies the player's tactics immediately with `applyTactics`, and queues their substitutions with `requestSub`. The player's side uses `humanManager`, which never changes tactics or makes subs on its own. Injured players are replaced like-for-like automatically for both sides. Keep the two paths identical: a test checks that stepping and simulating produce the same events.

Each team works in its own **team frame**, attacking towards x = 105. Convert with `toTeamFrame`/`fromTeamFrame` instead of special-casing home and away.

## Checking player behaviour

`src/analysis/` records a match the way an analyst would see it: every player's position each second, touches, and every pass, cross, shot and clearance. Views turn that into average positions, heat, touch and pass maps, running, action mix and a passing network, and `compare()` measures a change between a control and a treatment over the same seeds. Recording only reads state, so a recorded match is identical to `simulateEventMatch`.

After changing how players behave (a new instruction, a tactical option, movement or decisions), confirm it with the workflow in `.claude/skills/verify-player-behaviour/SKILL.md`. That file also lists what normal numbers look like and the pitfalls, and has throwaway recipes for debugging behaviour that doesn't change as expected: an intent log, "why" traces of decisions, and hand-built scenarios.

## Determinism

All randomness goes through an injected `Rng`. Never call `Math.random()` inside the engine or season code. The same seed must replay the same match or season, and tests rely on that.

## Calibration and balance (important)

The event engine's behaviour is emergent, and the constants interact strongly. After **any** change to `src/engine/`:

1. Run `bun run calibrate 5` (or 6 for a steadier read). The event engine should stay close to the Poisson engine: about 2.5–2.9 goals a game, about 25% draws, favourites winning about 55%, and a strength→GD correlation of about 0.45–0.5. Per-team stats should stay plausible: about 13 shots, about 260 completed passes at about 80% completion, roughly 7–10 fouls, 1–2 yellows, about 2 offsides, about 0.15 penalties, 3–5 subs, and added time of about 2 + 4 minutes.
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
- Parallel tuning workflows are CPU-bound, whether they run on pi or as Claude subagents and workflows; the same rules apply to both. One pi run with four agents played about 260,000 matches, and 40+ processes on 10 cores slowed each match from 67 to 274 ms. Use the harness in `.pi/probes/` (see its README): copy it into each worktree's `probes/`, and it runs every simulation through `slot.sh`, which caps processes machine-wide. Measure `main` once with `bash .pi/probes/baseline.sh` and hand agents `.pi/baseline/<sha>.txt` instead of letting each re-measure it. Budget the 4,000-match `tactics.sh 400` runs. A 100-match tactics run is about ±0.25 ppg noise, so it only catches gross breakage.
- Ball flight takes about a third of live play, so carriers have fewer seconds on the ball. That cut tackles and fouls, and was offset by raising `TACKLE_ATTEMPT` from 0.10 to 0.17. Completed passes fell from about 590 to about 360 a team, which is closer to real football.
- First touch: control takes 1–3 s depending on passing/dribbling and pressure, then a one-second look-up. The receiver moves with the ball meanwhile at 1.5 m/s, following the run they received it on and shielding from the nearest opponent, and a poor touch under close pressure can spill it. The carrier moves before anyone else picks a target, so home/away list order can't bias who sees which ball position. Faster carries used to inflate goals (3.4–4.5 a game at 2.5 m/s) because the receiving carry always headed for goal: open-play shots rose from 10 to 14.5 a team, from free ground the dribble decision never paid for, not from better chances. Deliberate forward running belongs to the dribble decision. Stopping retreating receivers from carrying the ball backwards was tried and favoured attacking setups (4-3-3 +0.41 over the mirror).
- Pacing: ball in play is about 62 minutes (real 55–60). It came down through more natural stoppages first (wider pass-error scatter, more poked tackles, blocked crosses behind) and then realistic restart times (about 24–40 s, including fetching the ball). Narrowing the pass-error scatter back to 6–18 m costs about 4 minutes of extra play and halves corners.
- Steering: players' `vel` and `facing` are for renderers too. Sharp reversals fell from 19% to 13%, p99 acceleration from 11.5 to 6 m/s², and overlaps to none. Steering retuned `PASS_BASE` 0.99→0.97, `TACKLE_ATTEMPT` 0.17→0.24, `OFFSIDE_GAMBLE` 2→3 m and `XG_MAX` 1.05→0.95. A 2.5 m/s look-up carry was tried again with steering and still gave 3.5 goals a game while the carry headed for goal (see First touch). The engine costs about 1.5× what it did before steering (about 60 ms a match); the hot paths in `steering.ts`, `movement.ts` and `valuation.ts` are written to avoid allocations, and an optimisation must leave a 90-match event fingerprint unchanged.
- `bun run calibrate` always plays the same few seeded worlds, so it can mislead about small changes. Steering seemed to cut the strength→GD correlation from 0.42 to 0.37 there, yet over 1,800 matches on 20 other worlds it was 0.44–0.46 (0.41–0.45 before steering). Check a surprising shift on other seasons before tuning for it. Likewise, use at least 400–500 matches per setting for a tactics verdict, and compare each setting with the 4-4-2 mirror match from the same run.
- Throw-ins come almost entirely from mis-hit passes. A wide mis-hit keeps the lane it was struck along (`WIDE_PASS_ERROR_RANGE`, `WIDE_PASS_ERROR_SPREAD`), so it overruns the touchline instead of scattering back infield; that took throw-ins from about 10 to 15 a team. On its own it lowered the strength→GD correlation on 20 unseen worlds to about 0.37; together with the carry change it was 0.42 (main 0.45).
- First-time passes (redirecting a safe short pass instead of controlling and looking up) were prototyped and dropped. They raised completed passes from 250 to about 320, but they amplify each mentality's passing preference: defensive teams, which weigh losses more, recycled sideways and backwards in their own third (231 first-time passes a match, −0.3 m average gain), while attacking teams played fewer, progressive ones that led to shots. Attacking +2 went from −0.06 to +0.24 ppg over the mirror. Requiring them not to lose ground flipped the skew instead. Reception time (control plus look-up, about 3.5 s) is the real lever for pass volume, and needs a design of its own.
- Shape changes that make a defensive mentality concede less also help underdogs, because the default manager has clear underdogs sit in. Midfield screens (one or two midfielders 5 m goal-side of the ball when defensive) made −1/−2 concede 15–20% fewer goals, but dropped the correlation on unseen worlds to about 0.3, whatever the screens' depth, count or zone. Offsetting it took a 7.5× `SHOT_SKILL` retune. A fix for defensive mentality needs a matching cost, or a change to how the default manager sets up underdogs.
- Raising `FOUL_ON_FAILED_TACKLE` to 0.42 gives real foul counts (about 11 a team; fouls are linear in it), but lowered the correlation to about 0.37: more fouls end more of the stronger side's attacks.
- Open-play crosses are only about 1.6 a team (the calibrate "crosses" figure includes corner deliveries; real football has 10+). Wide carriers often have a teammate in the box, but a cross completes about 20% of the time against about 80% for a ground pass, so crosses lose on value, not availability.
- Known open issues for animation: completed passes (about 240 a team) are below real football (about 375), and throw-ins (about 15) are short of the real 20. Contact corrections can still cause brief acceleration spikes.
- Board positions: slots come from each position's row and column. Small layout changes move balance a lot. A strike pair closed up to 14 m added about 0.7 goals a game, so strikers keep their columns. Wide players at a sixth of the width (instead of a fifth) made a very attacking 4-4-2 about +0.2 ppg stronger. In a 4-3-3 the central pair ahead of the holding midfielder stands 26 m apart (`SCREENED_PAIR_GAP`); 14 m apart, 4-3-3 was +0.44 ppg over the mirror. A sweep of holding depth, pair gap and winger position found winger position mattered least. A holding midfielder at 24 m balanced it as well, but cut underdogs' goals against an attacking 4-3-3 (the default manager's favourite setup) by a third and goals to 2.3–2.4 a game; check `bun run calibrate`, not only tactics runs, after changing a shape the default manager uses. Raising `XG_MAX` from 0.98 to 1.00–1.02 added under 0.06 goals.
- Out-of-possession shapes (400 matches each, against a 4-4-2 with the mirror at 1.44 ppg): 4-3-3 dropping to 4-1-4-1 1.38 (4-3-3 alone 1.34), 4-4-2 dropping a striker to CAM 1.46, full-backs as wing-backs in possession 1.29. A forward dropping to centre-back is 1.01: long transitions cost a lot.
- Custom shapes and pressing: the press zone (`PRESS_TRIGGER`, 30 m) is measured from the chaser's anchor, which follows the ball, so the higher a player's slot the further upfield they press. A CAM hunted centre-backs in their own third: a 4-3-3 with a CAM instead of the CDM won 2.31 points a game against a 4-4-2 mirror's 1.44, conceding 0.76, and a 4-4-2 with one central midfielder pushed to CAM won 1.95. Attacking midfielders (MID on row 4 in the current out-of-possession role) now press only within `HIGH_PRESS_TRIGGER` (15 m), which took those to 1.52 and 1.53 (a 4-2-3-1 is 1.45), and the presets are untouched since none has a row-4 midfielder. Stopping them pressing altogether only reached 2.10: a short press is better balanced than none. Still open (400 matches each): a CAM with the ball and a CDM without it wins 1.98, the CDM stepping up to CAM in build-up only 1.70, and a flat CM instead of the CDM 1.90. These keep 39% of the ball but take 15 shots; giving the press short reach whenever either role is a CAM only reached 1.80. Moving the 4-3-3 preset's CDM up from 29 to 33 m adds about 0.26 ppg, so central midfield depth is a strong lever generally. Phase shapes that keep the midfield's shape are within noise (full-backs pushing on in the final third 1.39, a 4-2-4 high block 1.40, a striker dropping in the low block 1.31).
- Known open imbalances (400 matches per setting, relative to the 4-4-2 mirror match in the same run): 4-5-1 is the strongest setting (about +0.15 ppg), 4-3-3 is about −0.1 and 5-4-1 the weakest (about −0.35). Defensive mentality (−1, −2) is about −0.2 and concedes more, not less: following the receiving run cost it about 0.15 ppg. Goals are about 2.5 a game in `bun run calibrate` (2.65 before board positions), at the bottom of the target, because the board's 4-3-3 gives underdogs fewer counters. Corners are about 4 a team, open-play crosses about 1.6, and fouls about 6.
- Pace and acceleration (`PACE_EFFECT` 0.012, `ACCEL_EFFECT` 0.03) are close to neutral for balance: over 300 fresh matches goals went from 2.50 to 2.41 (within noise), shots stayed at 10 a team, and `corr.sh` gave 0.45/0.51 against main's 0.44/0.52. `bun run calibrate` swung between 0.38 and 0.45 across small variants, so judge correlation on `corr.sh`. p99 speed rose from 6.0 to 6.1 m/s and acceleration spikes didn't change. `raceWinChance` uses pace and tiredness (`speedFactor`), like steering. The tactics probe uses `strongVsWeak`, whose players are all 10, so it can't see physicals.
- Physical attributes (jumping and strength) at the values in `constants.ts`: `bun run calibrate 6` gave 2.31 goals a game (main 2.50) and strength→GD 0.40 (main 0.42), so goals fall below the 2.5–2.9 target. Halving all four coefficients gave 2.35 goals and 0.44 correlation, so the goal drop is not just their size. On 900 unseen-world matches (`corr.sh`) the full values gave 0.49 (main 0.48) and the halved 0.45. Seeded defenders jump and are stronger than attackers, so headers go to the defence more often. The underdog check in `engine.test.ts` (300 matches) then fails: 521 conceded deep against 517 open, where main passes.

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

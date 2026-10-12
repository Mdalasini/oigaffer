---
name: verify-player-behaviour
description: How to confirm that a change to player behaviour in the event engine (a new player or team instruction, a tactical option, a change to movement, decisions or roles) actually makes players act as intended, using analyst views of recorded matches (average positions, heat maps, touch maps, pass maps, running, action mix, passing network) compared between a control and a treatment. Use after implementing or changing any instruction or behaviour in src/engine/, src/tactics.ts or src/manager.ts, and whenever asked to check that players do what an instruction says.
---

# Verifying player behaviour

Judge a behaviour change the way an analyst judges a player without watching the game: from positions, touches, passes and running. The tools are in `src/analysis/`:

- `record.ts`: `recordMatch(world, home, away, rng, managers)` plays a normal event-engine match and returns a `Recording`. Recording only reads state, so the match is identical to `simulateEventMatch`. A recording holds:
  - `frames`: every player on the pitch, every second. Each frame has `pos`, `slot` (formation anchor), `speed`, current `role`, `phase` (`attack`/`defend`/`loose` from that player's team's view), `dead` (restart being set up) and `onBall`.
  - `touches`: the start of each spell on the ball (`open_play` or `restart`).
  - `strikes`: every pass, through ball, cross, shot and clearance, with `from`/`to`, what was rolled (`type`, `outcome`), the intended receiver, and `kept` (whether the striker's team had the next player to control the ball).
  - `events`: the normal event log.
  - Every position is in the player's **team frame**: x from their own goal line (0) to the opponents' (105), y from 0 to 68 across. Home and away players can be pooled.
- `views.ts` turns any selection of frames, touches or strikes into numbers and text grids:
  - `averagePosition` (x, y, width, distance from slot)
  - `heatMap`, `touchMap`, `grid` and `formatGrid` (6×3 zones by default)
  - `running` (distance, high-intensity distance and sprints per 90)
  - `passing` (attempts, kept, forward, progressive, length, origin and destination grids)
  - `actionMix`, `passNetwork`
  - `report(rec, ids)`, which prints all of the above for a player or a group
- `compare.ts`: `compare({ count, seed, control, treatment, measure })` plays the same seeds with and without the change. `measure` reduces each recording to named numbers. The result has the means, the paired difference, its standard error and a z score. `formatComparison` prints it and marks |z| ≥ 3. `gridMetrics` turns a grid into named numbers so heat maps can be compared zone by zone.

## Workflow

1. **Write the expected behaviour down in football terms before measuring.** Say who should do what, in which phase, and where. Also say what should *not* change. For example: "With *CB steps into midfield*, the chosen centre-back's average x in possession rises from the defensive line to the midfield line, and his touches and pass origins move up with it. Out of possession he is back in the line. The other centre-back and the full-backs barely move."
2. **Choose the views that would show it.**

   | The instruction is about… | Look at |
   |---|---|
   | Where a player stands (step up, stay wide, drop deep, tuck in, hold position) | `averagePosition` and `heatMap`, split by `phase`, live frames only (`!f.dead`) |
   | Where a player gets the ball (come short, get into the box) | `touchMap` of `open_play` touches |
   | How a player passes (go long, play through balls, switch play, cross more) | `passing`: `byType`, `length`, `forward`, `progressive`, `to` grid, `kept` |
   | Running and work rate (press, overlap, run in behind) | `running`, heat map out of possession, `actionMix` (tackles, interceptions, recoveries) |
   | Decisions (shoot less, dribble more) | `actionMix`, shot `from` positions |
   | Who links with whom | `passNetwork` |

3. **Eyeball one match first.** Write a throwaway probe in the scratchpad, never in `src/`. Print `report()` for the affected player and a neighbour with and without the change. It's quick and catches broken wiring before you spend CPU.
4. **Compare control and treatment with `compare()`.** Use the same fixture, usually `strongVsWeak(12, 12)` with `fixedManager` tactics. The control has the instruction off, the treatment has it on, and nothing else differs. Measure the intended effect *and* the things that shouldn't change: the other players in the line, goals for and against, and the team's `kept` share.
   - Strong positional effects show up in 4–10 matches. Rates of rare actions (crosses, through balls, shots by one player) need 50–200.
   - Read the z score, not the size of the difference: |z| < 2 is noise.
   - A recorded match costs about 150 ms. Run anything over about 50 pairs through the CPU harness: `bash .pi/probes/slot.sh bun <probe>.ts` (see `.pi/probes/README.md`).
5. **Check the side effects with the usual engine checks.** Run `bun run calibrate 5`. If the change touches shape, pressing, marking or anything mentality and formation feed into, run the tactical balance check in `AGENTS.md`. An instruction that works but wins every match isn't done.
6. **Turn the clearest difference into a test** next to the instruction. Use `compare()` with the fewest matches that give |z| well above 3, a loose threshold, and `SLOW_TEST` as the timeout. `src/analysis/compare.test.ts` is the pattern.
7. **Report honestly**, with the numbers, including side effects and anything that didn't move as expected.

## Probe template

```ts
// scratchpad/probe.ts: run with `bun probe.ts`, imports by absolute path to the repo
import { strongVsWeak } from "<repo>/src/test-helpers";
import { fixedManager } from "<repo>/src/manager";
import { recordMatch } from "<repo>/src/analysis/record";
import { compare, formatComparison } from "<repo>/src/analysis/compare";
import { averagePosition, passing, report } from "<repo>/src/analysis/views";
import { seededRng, type Rng } from "<repo>/src/random";

const world = strongVsWeak(12, 12);
const play = (tactics: Parameters<typeof fixedManager>[0]) => (rng: Rng) =>
  recordMatch(world, world.clubs.strong!, world.clubs.weak!, rng, { home: fixedManager(tactics) });
const control = play({ formation: "4-4-2", mentality: 0 });
const treatment = play({ formation: "4-4-2", mentality: 0 /* , the new instruction */ });

console.log(report(treatment(seededRng(1)), ["s2"], "s2 with the instruction"));

const live = (rec: ReturnType<typeof control>, id: string, phase: "attack" | "defend") =>
  rec.frames.filter((f) => f.id === id && !f.dead && f.phase === phase);
console.log(formatComparison(compare({
  count: 20, seed: 1, control, treatment,
  measure: (rec) => ({
    "s2 x in possession": averagePosition(live(rec, "s2", "attack")).x,
    "s2 x out of possession": averagePosition(live(rec, "s2", "defend")).x,
    "s3 x in possession": averagePosition(live(rec, "s3", "attack")).x,
    "home pass kept": passing(rec.strikes.filter((s) => s.side === "home")).kept,
    "goals for": rec.score.home,
    "goals against": rec.score.away,
  }),
})));
```

In `strongVsWeak` the ids run `s0` (GK), `s1`–`s4` (DEF), `s5`–`s8` (MID), `s9`–`s10` (FWD) for the home side, and `w0`… for the away side. A player's role can change mid-match, so select by id when the instruction targets one player, and by `role` when it targets a line.

## What normal looks like

Measured over 20 matches of `strongVsWeak(12, 12)`, balanced 4-4-2 against 4-4-2, live frames:

| | x in possession | x out of possession | width in / out | m per 90 | high intensity per 90 | sprints per 90 |
|---|---|---|---|---|---|---|
| DEF | 21 | 26 | 18 / 13 | 9,900 | 5,100 | 8.5 |
| MID | 37 | 48 | 18 / 13 | 10,400 | 5,600 | 12.8 |
| FWD | 77 | 63 | 16 / 11 | 11,600 | 5,300 | 4.3 |

A team makes about 335 pass attempts (passes and crosses), keeps the ball after 82% of them, and averages 22 m a pass, with 25% progressive.

Known oddities: these are engine facts, not tracking bugs, and an instruction may run into them.
- Teams do most of their possession in their own half (the ball carrier averages x ≈ 34). So defenders and midfielders stand *deeper* in possession than out of it, which is the opposite of real football.
- About half of all running is above 5.5 m/s, because off-ball players run at `MOVE_SPEED` (6 m/s). Real players cover only about 7–10% of their distance at that speed. Compare high-intensity running between setups, never against real figures.

## Debugging: when the numbers don't move as expected

These three tools are **throwaway**: write them as scratchpad probes, never in `src/` and never committed. Use them to find out *why* a player isn't doing what the instruction says. Then confirm the fix with the workflow above.

The intent log and "why" traces use the optional `state.debug` hook (`src/engine/debug.ts`). The engine calls it only when it is set and never reads anything back, so a match plays out identically with or without it. `src/engine/debug.test.ts` checks that. Nothing in `src/` sets it.

- `intent(state, player, intent, target, speed)` is called once per player per second, after targets are chosen. `intent` names the branch of `movement.ts` that chose the target:
  - **ball carrier:** `walk_to_restart`, `hold`, `first_touch`, `look_up`, `take_on`
  - **off the ball:** `kickoff`, `penalty_position`, `set_piece_position`, `receive`, `press`, `chase`, `keeper`, `mark`, `cover`, `on_shoulder`, `shape`, `give_room`

  A new behaviour in `movement.ts` should add its own intent to the `Intent` union, so the log can show it.
- `decision(state, carrier, options, probabilities, chosen)` is called whenever a carrier picks an action. `options` are the scored `Option`s from `decide.ts`, and `probabilities` is the softmax chance of each.

To drive a match yourself with the hook set, use `startEventMatch`, set `state.debug`, and loop `stepEventMatch` until `isFullTime`.

### Intent log: is the player even trying?

Count each player's (or role's) intents over a few matches. If an instruction is meant to make a centre-back step up but his intent is still `shape` or `cover`, the problem is in target selection, not in the outcome rolls.

```ts
const counts: Record<string, Record<string, number>> = {};
const state = startEventMatch(world, world.clubs.strong!, world.clubs.weak!, seededRng(1));
state.debug = { intent: (_s, p, intent) => { const r = (counts[p.id] ??= {}); r[intent] = (r[intent] ?? 0) + 1; } };
while (!isFullTime(state)) stepEventMatch(state);
// print each id's intents as % of its seconds
```

Normal (5 matches, 4-4-2), as a share of seconds:

| Role | Intents |
|---|---|
| DEF | `shape` 43%, `cover` 28%, `mark` 16%, set pieces 7% |
| MID | `shape` 82%, `mark` 4%, `press` 2.6% |
| FWD | `on_shoulder` 41%, `shape` 35%, `mark` 10% |
| GK | `keeper` 91% |

### "Why" trace: what did he weigh up?

Print a player's decisions with the top options and their chances:

```ts
const label = (o: Option) => { const a = o.action;
  return a.kind === "pass" || a.kind === "through" ? `${a.kind}→${a.receiver.id}` : a.kind === "cross" ? `cross→${a.target.id}` : a.kind; };
state.debug = { decision: (s, p, options, probs, chosen) => {
  if (p.id !== "s2") return;
  const at = toTeamFrame(p.side, p.pos);
  const ranked = options.map((o, i) => ({ o, p: probs[i]!, i })).sort((a, b) => b.p - a.p);
  const shown = ranked.slice(0, 4);
  if (!shown.some((r) => r.i === chosen)) shown.push(ranked.find((r) => r.i === chosen)!);
  console.log(`${Math.floor(s.clock / 60)}' ${p.id} at (${at.x.toFixed(0)}, ${at.y.toFixed(0)}) ${s.ball.setPiece ?? "open play"}`);
  for (const r of shown) console.log(`  ${r.i === chosen ? ">" : " "} ${label(r.o).padEnd(16)} ${r.o.utility.toFixed(3)}  ${(r.p * 100).toFixed(0)}%`);
} };
```

Utilities are in expected-goal units and are usually small and close together (a centre-back's top four options are often all 0.008–0.014). So the softmax often picks the second or fourth option. An instruction that nudges utilities slightly may barely change behaviour.

### Scenario: one situation, set up by hand

When the question is "in *this* situation, does he do the right thing?", build the situation directly instead of waiting for it in a match. It's deterministic, takes milliseconds, and isolates the mechanism. The engine's own `flight.test.ts` and `touch.test.ts` set states up the same way.

```ts
const m = fixedManager({ formation: "4-4-2", mentality: 0 });
const state = createMatchState(world, world.clubs.strong!, world.clubs.weak!, seededRng(1), { home: m, away: m });
state.phase = "first_half";
for (const p of state.players) p.pos = fromTeamFrame(p.side, p.slot); // everyone on their formation slot
const cb = state.players.find((p) => p.id === "s2")!;
cb.pos = fromTeamFrame("home", { x: 30, y: 26 });             // the situation
giveBall(state, cb, 0);                                       // 0 = ready to act now
console.log(scoreOptions(state, cb).sort((a, b) => b.utility - a.utility).slice(0, 5)); // what he could do
state.debug = { intent: (s, p, intent, target) => { if (p.side === "home") console.log(s.time, p.id, intent, toTeamFrame(p.side, target)); } };
for (let i = 0; i < 3; i++) stepEventMatch(state);            // what everyone does next
```

- `scoreOptions` shows the choice without rolling it.
- Stepping shows the movement. The first step also consults the managers, which shows up as `tactics` events.
- Try a few seeds before drawing a conclusion from anything rolled.

## Pitfalls

- **Phase confounds position.** "In possession" also means "the ball is where we usually have it". Compare the same phase between control and treatment, never in-possession against out-of-possession within one setup.
- **Exclude dead-ball frames** (`!f.dead`) from positional views. Players walking to restarts distort them.
- **The fixture changes the answer.** Strong teams spend more time in possession. Use `strongVsWeak(12, 12)` unless the instruction is about mismatches, then check a second fixture before trusting a surprising result.
- **One player's numbers are noisy.** Pool a line, or add matches.
- If an instruction needs data the recording doesn't hold, add it to `record.ts` (and keep recording read-only). Don't compute it ad hoc in a probe that the next person can't reuse.

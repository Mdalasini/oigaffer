export const meta = {
  name: 'ball-flight-explore',
  description: 'Prototype and compare ball-flight and player-motion designs for an animatable oigaffer match engine',
  phases: ['Harness', 'Prototype'],
}

// Run with --cwd pointing at a folder holding five git worktrees of the repo:
// base/ (harness only), sched/, arrival/, steering/, touch/ (one prototype each).

const CONTEXT = `
This is oigaffer, a football-manager simulator in TypeScript on Bun (read AGENTS.md first; it explains the layout, calibration targets and code style).
The event match engine lives in src/engine/: match.ts (tick, startEventMatch, stepEventMatch, simulateEventMatch, isFullTime), state.ts (MatchState, MatchPlayer, Ball, giveBall, looseBall, ballDead),
decide.ts (chooses actions), resolve.ts (rolls outcomes: resolvePass, resolveCross, resolveShot, resolveClear, resolveDribble, attemptTackle), movement.ts (kinematic steering: moveOffBall, pickUpLooseBall),
restarts.ts (placeBall, set pieces), formation.ts, valuation.ts, constants.ts (every tuning number).
One tick = one second. Pitch 105 x 68 m. World setup: import { generateWorld, DEFAULT_CLUBS } from "./src/seed"; import { seededRng } from "./src/random".

The team wants to ANIMATE matches on a 2D pitch, not just commentate. Known problems today:
- The ball jumps instantly from passer to receiver/target in the same tick: no flight time, no height. Crosses, headers, shots and clearances all resolve the tick they are struck.
- A receiver stands still for CONTROL_TICKS (3 s) while "controlling" the ball.
- Players have no velocity or facing: movement is "move up to speed metres towards a target" each tick, so ~19% of steps are sharp reversals; players can overlap each other.
- Ball in play ~75 min (real 55-60), players run ~15 km (real 10-11), more passes than real football.
The engine is statistically calibrated against a Poisson engine (bun run calibrate): ~2.5-2.9 goals/game, ~25% draws, favourites win ~55%, strength->GD correlation ~0.45-0.5, ~13 shots, ~80% pass completion per team. Any design must keep these numbers close (retuning constants is allowed) and stay deterministic (all randomness via state.rng, never Math.random).
`

const HARNESS_BRIEF = `${CONTEXT}
YOUR TASK: in the folder base/ (a git worktree of the repo; work only inside it), write a reusable measurement harness probes/metrics.ts that other agents will copy into their own worktrees, where the engine will have been modified.
Run as: bun probes/metrics.ts [matches=60] [seed=1] and print ONE JSON object to stdout (log anything else to stderr). It must only rely on stable APIs (startEventMatch, stepEventMatch, isFullTime, state.players[].pos, state.ball.pos, state.ball.ownerId, state.events, ballDead) and read optional new fields defensively if present
(player.vel, player.facing, ball.height, ball.vel or ball.flight — whatever exists, e.g. via (p as any).vel). Pair clubs from generateWorld(DEFAULT_CLUBS, rng) round-robin, step each match tick by tick, and measure:
- goalsPerGame, homeWinPct, drawPct, passesPerTeam, passCompletion, shotsPerTeam (from events)
- ballInPlayMin (ticks where !ballDead and phase is a half, /60), msPerMatch
- distancePerOutfieldKm (sum of per-tick displacement for non-GK players present the whole match, scaled to 90 min)
- playerSpeed p50/p99/max (m/s), playerAccel p99/max (m/s^2, change of per-tick displacement vector), reversalPct (share of moving steps whose direction turns more than 120 degrees vs the previous step, counting only steps > 0.5 m)
- overlapPerTick (mean number of player pairs closer than 0.8 m), worstOverlapM
- ballSpeed: p50/p99/max of per-tick ball displacement while not dead, plus the share of ticks where the ball moves more than 35 m in one tick ("teleport" share)
- receiverFreezeS: mean consecutive ticks a player who just received a pass (pass event) stays within 0.5 m of where they received it
- inFlightPct: share of in-play ticks where the ball has no owner (loose or in flight)
- if ball.height exists: maxHeight and share of ticks with height > 1 m
Also write probes/calib.sh that runs "bun run calibrate 3" and prints its output. Run both against the unmodified engine and include the baseline numbers in your answer. Keep the harness fast (60 matches should take well under a minute). Do not edit src/. Do not commit.
Return JSON: { harnessPath, baseline (the metrics JSON), calibrateSummary (key lines of calibrate output), notes }`

const PROTO_COMMON = `${CONTEXT}
You are one of several agents each prototyping a DIFFERENT design in its own git worktree. Yours is the folder WT/ (relative to your working directory). Work ONLY inside WT/; never touch the other folders except to copy the harness.
Setup: mkdir -p WT/probes && cp base/probes/metrics.ts base/probes/calib.sh WT/probes/. First run "cd WT && bun probes/metrics.ts 60 1" and "bash probes/calib.sh" on the unmodified engine to get your own baseline.
Then implement your design in WT/src/engine (prototype quality is fine, but it must typecheck and keep existing tests passing or be honestly reported as failing). Keep it deterministic. Put new tuning numbers in constants.ts.
Retune existing constants if your change shifts calibration, but report what you changed and why. Measure again with the harness and calibrate. Run "bun test" and "bun run typecheck".
Commit your work in WT with git (git add -A && git commit -m "<design>: prototype") so it can be diffed — this is a detached scratch worktree, committing there is expected. Do not push. Do not run git commands outside WT.
Be honest: report what got worse as well as what got better, and how invasive the change is (files/lines touched).
`

const PROTOS = [
  {
    wt: 'sched',
    label: 'ball-scheduled-flight',
    brief: `DESIGN A — "scheduled flight": keep today's decision and outcome rolls, but give the ball a real flight.
When a pass, through ball, cross, shot or clearance is struck, compute a flight: origin, destination, launch tick, arrival tick (from distance and a ball speed per kind:
e.g. ground pass ~15 m/s, driven/long ~20 m/s, cross ~20 m/s lofted, shot ~25 m/s, clearance ~22 m/s lofted), and a height profile (ground passes stay at 0; lofted balls follow a parabola with a peak height per kind).
Roll the outcome at launch as now, but APPLY it on arrival: the ball has no owner while in flight, ball.pos is interpolated along the path each tick, ball.height is exposed, and the receiver/interceptor/keeper moves to meet the ball at the arrival point during the flight.
Nobody can tackle or pick up the ball while it is in flight. Header/shot from a cross happens after the cross arrives. Expose ball.flight (or similar) so a renderer can interpolate at sub-second precision.
Report how this changes ball-in-play time, pass counts, calibration and how many code paths had to change.`,
  },
  {
    wt: 'arrival',
    label: 'ball-resolve-on-arrival',
    brief: `DESIGN B — "resolve on arrival": the ball physically travels (position, velocity, height advanced each tick, optionally with a few sub-steps per tick), and outcomes are decided from what actually happens along the path rather than rolled at launch.
Passes are aimed at a point (lead the receiver if moving); each tick, any player who can reach the ball's path (within a reach radius scaled by height: feet < 1 m, head 1-2.5 m, nobody above that except keepers in their box) may control or intercept it, with a skill-based chance; whoever reaches the ball first gets it.
Inaccurate passes get an aiming error at launch rather than a separate "astray" outcome. Crosses are lofted and contested on arrival (keeper claim vs aerial duel). Shots travel to goal and can be blocked by bodies in the path, then the keeper saves or not on arrival.
Expose ball.vel and ball.height. This is the more physical, emergent option; expect calibration to move a lot — retune what you must (pass accuracy, intercept constants, xG scale) and report how close you got and how much effort it took.
Report how this changes ball-in-play time, pass completion, interceptions, calibration and how invasive the change is.`,
  },
  {
    wt: 'steering',
    label: 'player-steering',
    brief: `DESIGN C — "player steering": give every MatchPlayer a velocity vector and a facing angle, and move them with acceleration-limited steering instead of jumping up to speed metres towards a target.
Ideas to try and compare (measure each variant you try): max acceleration ~3-4 m/s^2 and deceleration ~5-6 m/s^2; facing turns towards the velocity (or towards the ball when nearly still) with a turn rate limit (~360 deg/s jogging, less when sprinting);
arrival slowing near the target; separation so players keep ~1 m apart (a small repulsion in the steering sum); optionally sub-steps inside each 1 s tick (e.g. 4 x 0.25 s) for smoother paths.
Keep all existing targets (pressing, marking, cover, restarts, chasing loose balls) — only change how players get there. Fatigue should still come from distance run.
Target realistic motion: distance ~10-11 km per outfield player, far fewer sharp reversals, no overlaps, max speed ~9 m/s. Watch the effect on pressing and tackles (slower to close down), and on calibration and tactical balance; retune if needed.
Report the metrics per variant and recommend one.`,
  },
  {
    wt: 'touch',
    label: 'first-touch-and-pacing',
    brief: `DESIGN D — "first touch and pacing": fix the receiver freeze and the too-high ball-in-play/pass counts without (yet) adding ball flight.
1) Moving first touch: instead of standing still for CONTROL_TICKS, a receiver keeps moving while controlling the ball — the first touch carries it a few metres in a sensible direction (away from the nearest opponent / towards goal), the ball moves with them, and control time depends on pressure and passing/dribbling skill (e.g. 1-3 s). Under heavy pressure a poor first touch can give the ball away.
2) Carrying: the carrier jogs with the ball between decisions rather than standing still (carry speed slower than running speed).
3) Pacing: find what drives ball-in-play to ~75 min (real 55-60) and passes too high — e.g. too few stoppages, out-of-play too rare, decisions too frequent — and try changes that bring them towards real values while keeping calibration.
Report the metrics for each change you try and what you recommend.`,
  },
]

const HARNESS_SCHEMA = {
  type: 'object',
  required: ['harnessPath', 'baseline'],
  properties: {
    harnessPath: { type: 'string' },
    baseline: { type: 'object', additionalProperties: true },
    calibrateSummary: { type: 'string' },
    notes: { type: 'string' },
  },
}

const PROTO_SCHEMA = {
  type: 'object',
  required: ['design', 'summary', 'baseline', 'after', 'calibration', 'tests', 'recommendation'],
  properties: {
    design: { type: 'string' },
    summary: { type: 'string' },
    commit: { type: 'string' },
    filesChanged: { type: 'string' },
    baseline: { type: 'object', additionalProperties: true },
    after: { type: 'object', additionalProperties: true },
    variants: { type: 'array', items: { type: 'object', additionalProperties: true } },
    calibration: { type: 'string', description: 'before and after calibrate key numbers' },
    constantsChanged: { type: 'string' },
    tests: { type: 'string', description: 'bun test and typecheck results' },
    worse: { type: 'string', description: 'what got worse or is unresolved' },
    recommendation: { type: 'string' },
  },
}

phase('Harness')
const harness = await agent(HARNESS_BRIEF, {
  label: 'harness',
  tools: 'all',
  thinking: 'medium',
  schema: HARNESS_SCHEMA,
  stallMs: 900000,
})

phase('Prototype')
const protos = await pipeline(PROTOS, (p) =>
  agent(`${PROTO_COMMON.replaceAll('WT', p.wt)}\n${p.brief}\n\nThe harness author reported this baseline: ${JSON.stringify(harness.baseline)}\n\nReturn JSON with design="${p.label}".`, {
    label: p.label,
    tools: 'all',
    thinking: 'high',
    schema: PROTO_SCHEMA,
    stallMs: 1800000,
  }),
)
return { harness, protos }

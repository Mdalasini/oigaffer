export const meta = {
  name: 'engine-audit',
  description: 'Probe the oigaffer event match engine for realism, animation-readiness, consistency and robustness',
  phases: ['Audit'],
}

// Every auditor works in the same scratch checkout. They may only write under probes/<area>/.
const COMMON = `
You are auditing the event-based football match engine in this TypeScript/Bun repo (read AGENTS.md first; it explains the layout).
Key files: src/engine/match.ts (startEventMatch, stepEventMatch, simulateEventMatch, isFullTime), src/engine/state.ts (MatchState, MatchPlayer, Ball, MatchEvent types),
src/engine/decide.ts, resolve.ts, movement.ts, formation.ts, referee.ts, restarts.ts, lineup.ts, fatigue.ts, valuation.ts, constants.ts.
World setup: import { generateWorld, DEFAULT_CLUBS } from "src/seed"; import { seededRng } from "src/random"; clubs are Object.values(world.clubs).
Pitch is 105 x 68 metres, one tick = one second, positions in metres (x goal to goal, y touchline to touchline).

RULES:
- Do NOT edit anything under src/, ui/, or any existing file. Write your probe scripts ONLY under probes/AREA/ (create it). Run them with "bun probes/AREA/<file>.ts".
- Use seeded RNGs so results are reproducible. Keep each probe run under ~3 minutes (about 50 matches is ~3s; stepping matches tick by tick to sample state is fine).
- Do not run git commands that change anything. No network access needed.
- Base every finding on numbers you actually measured or code you actually read; include the measured numbers and file:line references as evidence.
- Compare with real professional football where relevant and say what the real figure is.
- Severity: high = clearly wrong / would look broken / a bug; medium = noticeably unrealistic; low = polish.
- Return at most 10 findings, most important first, each with a concrete suggested fix (which file/function and what to change).
`

const SCHEMA = {
  type: 'object',
  required: ['area', 'summary', 'findings'],
  properties: {
    area: { type: 'string' },
    summary: { type: 'string' },
    metrics: { type: 'object', additionalProperties: true },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'title', 'evidence', 'suggestion'],
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          title: { type: 'string' },
          evidence: { type: 'string' },
          suggestion: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const AREAS = [
  {
    id: 'animation-motion',
    brief: `AREA: player and ball motion as it would look if animated (the team plans to render matches visually, not just commentate).
Step matches tick by tick (startEventMatch + stepEventMatch) and record every player's position and the ball position each tick.
Measure: per-tick displacement distribution per player (max, p99; flag anything above ~9 m/s which no footballer can run), count and causes of teleports
(e.g. restarts in src/engine/restarts.ts setUp/penalty, kickoff in formation.ts, goalKick keeper placement, substitutes appearing in place, keepDistance pushes in movement.ts),
the ball's implied speed between ticks (the ball currently jumps instantly to its destination; measure how far it moves in one tick for passes, clearances, crosses, shots),
jitter/oscillation (players reversing direction tick to tick), players overlapping (two players within 0.5 m), anyone off the pitch, NaN positions.
Report what would look broken on screen and what state the engine would need to expose for smooth animation (ball flight time/height, velocities, facing).`,
  },
  {
    id: 'spatial-shape',
    brief: `AREA: spatial realism of team shape and positioning.
Sample positions over many matches. Measure: average position and heat spread per role (GK/DEF/MID/FWD) in each team's attacking frame (see toTeamFrame),
team length (deepest to highest outfield) and width in and out of possession (real: ~30-35 m long, ~40-50 m wide in possession, more compact out),
distance between lines, how often defenders end up behind their own keeper, keeper distance from goal, how far players are from their formation slot,
whether wide players hug the touchline, positions during corners (attackers/defenders in the box) and penalties (everyone else outside the box),
whether the defensive line holds an offside line sensibly. Report anything that would look unlike football on a 2D pitch view.`,
  },
  {
    id: 'event-consistency',
    brief: `AREA: logical consistency of the event stream (src/engine/state.ts MatchEvent).
Over 100+ seeded matches check invariants, for example: a pass/through_ball receiver is a teammate of the passer and on the pitch; the next on-ball action after a completed pass is by the receiver;
players who were substituted, sent off or injured never appear in later events; a team never has more than 11 or fewer than 7 players;
shots by kind make sense (headers from inside or near the box, penalties from the spot, free-kick shots from free kicks, no open-play shots from a team's own half unless rare);
offside is never called on a player in his own half or from a throw-in/goal kick/corner; corners are taken from a corner flag, throw-ins from a touchline, goal kicks from the six-yard area;
set_piece events are followed by an action by the taker; card counts (no third yellow, second_yellow only after a yellow); score equals goal events; subs <= 5 per side; clock/period monotonic, added_time once per half, exactly one half_time and full_time whistle.
Report every violated invariant with counts and an example (seed, clock, events).`,
  },
  {
    id: 'stats-realism',
    brief: `AREA: statistical realism against real professional football (e.g. Premier League averages).
Simulate 200+ matches with generateWorld(DEFAULT_CLUBS) clubs paired round-robin. Measure per team per match and as distributions:
goals and scoreline distribution (0-0 rate real ~7-8%, 1-1 ~11%), shots, shot distance distribution, xG per shot, conversion, shots on target, passes and pass completion, pass length distribution,
possession split spread, crosses, corners (real ~5), throw-ins (real ~20-25), goal kicks (~7-8), free kicks, fouls (~10-11), offsides (~2), yellows (~1.7-2), reds (~0.06 per team),
penalties (~0.13 per team), goals by minute (real: more goals late, ~55% in second half), ball-in-play time (real ~55-60 of 90+ min; compute from dead-ball periods via Ball.setPiece/readyAt or by counting ticks where ballDead(state) is true),
distance covered per outfield player (real ~10-11 km; derive from positions), substitutions timing, added time.
Report which numbers are far off and the likely cause in code.`,
  },
  {
    id: 'timing-flow',
    brief: `AREA: timing and flow of play, i.e. how a match unfolds second by second (important for animation pacing).
Step matches and measure: actions per minute, how long a player holds the ball before acting (CONTROL_TICKS), time between possession changes, length of possessions (passes per possession; real median ~3-4),
how long dead-ball restarts take (throw-ins, goal kicks, corners, free kicks, penalties, kickoffs after goals) vs real (throw-in ~10-15 s, corner ~25-30 s, goal kick ~20 s),
how quickly a ball played into space is reached, how often the ball sits loose with nobody near it and for how long, and any stalls (ball owned but nobody acts for many ticks, or loose ball unreached for > 10 s).
Also check the half-time and full-time transitions and added time in src/engine/match.ts stepEventMatch.`,
  },
  {
    id: 'robustness',
    brief: `AREA: robustness and edge cases. Write stress/fuzz probes:
run 500+ matches across many seeds checking for thrown errors, NaN, infinite loops (cap ticks), and determinism (same seed twice gives identical events);
force extreme situations via the public API: send off many players with sendOff from src/engine/lineup.ts (down to 7 and below - what happens? real rules abandon a match below 7),
send off the keeper when no bench keeper exists, use all 5 subs then injure a player, requestSub with invalid ids/duplicate/same player twice, applyTactics during a dead ball or penalty,
formations when a team has no natural forwards or defenders (build a custom GameWorld), squads with fewer than 11 players, a team with only one player in a line.
Also time simulateEventMatch (ms per match) and look for anything quadratic.`,
  },
  {
    id: 'code-review',
    brief: `AREA: correctness review of the rules code. Carefully read src/engine/referee.ts, restarts.ts, lineup.ts, resolve.ts, decide.ts, movement.ts, fatigue.ts and match.ts.
Look for real bugs: wrong side/team-frame conversions (home vs away, toTeamFrame), off-by-one in clocks/periods, state not reset (ball.setPiece, runnerId, cooldowns), events emitted with the wrong side,
fouls/cards logic errors (e.g. advantage when the victim no longer has the ball, DOGSO logic), restarts given to the wrong team, pending substitutions edge cases, keeper role swaps, scatter/clamp mistakes, unreachable code.
For every suspected bug, write a tiny probe that demonstrates it and report the probe output as evidence. Do not report style issues.`,
  },
  {
    id: 'tactics-behaviour',
    brief: `AREA: whether tactics and player attributes visibly change behaviour (a manager game must make choices matter, and an animated view must show it).
Using strongVsWeak from src/test-helpers.ts and fixedManager from src/manager.ts, compare formations (5-4-1, 4-4-2, 4-3-3, 3-4-3) and mentality -2..+2 on observable behaviour, not just results:
average team height and width, passes per possession, crosses, long balls/clearances, pressing distance, shots and where they come from.
Also check individual attributes matter visibly: a high-dribbling winger takes on more players, a great passer plays more through balls, a high-stamina player tires less (energy at 90').
Report choices or attributes that make no visible difference, or differences that look wrong.`,
  },
]

phase('Audit')
const results = await pipeline(AREAS, (a) =>
  agent(`${COMMON.replaceAll('AREA', a.id)}\n${a.brief}\n\nReturn JSON with area="${a.id}".`, {
    label: a.id,
    tools: 'all',
    thinking: 'medium',
    schema: SCHEMA,
    stallMs: 600000,
  }),
)
return results

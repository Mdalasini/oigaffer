// Usage: bun probes/metrics.ts [matches=60] [seed=1]
// Percentages are 0–100. Quantiles use 0.01 m bins (maxima are exact).
// Only sampled positions are used: velocity/facing fields need not exist.
import { startEventMatch, stepEventMatch, isFullTime } from "../src/engine/match";
import { ballDead } from "../src/engine/state";
import { doubleRoundRobin } from "../src/fixtures";
import { generateWorld, DEFAULT_CLUBS } from "../src/seed";
import { seededRng } from "../src/random";

const matches = Number(process.argv[2] ?? 60);
const seed = Number(process.argv[3] ?? 1);
if (!Number.isSafeInteger(matches) || matches < 1 || !Number.isSafeInteger(seed)) {
  console.error("Usage: bun probes/metrics.ts [positive integer matches=60] [integer seed=1]");
  process.exit(1);
}

function distribution() {
  const bins: number[] = [];
  let count = 0, max = 0;
  return {
    add(value: number) {
      if (!Number.isFinite(value) || value < 0) return;
      const bin = Math.floor(value * 100);
      bins[bin] = (bins[bin] ?? 0) + 1;
      count++;
      max = Math.max(max, value);
    },
    result() {
      const quantile = (fraction: number) => {
        if (!count) return 0;
        let seen = 0;
        for (let i = 0; i < bins.length; i++) {
          seen += bins[i] ?? 0;
          if (seen >= Math.ceil(count * fraction)) return i / 100;
        }
        return max;
      };
      return { p50: quantile(0.5), p99: quantile(0.99), max };
    },
  };
}
interface Track {
  x: number; y: number; dx: number; dy: number;
  previousMoving: boolean; hasStep: boolean;
  distance: number; whole: boolean; outfield: boolean;
}
interface Freeze { x: number; y: number; ticks: number }
const speed = distribution(), accel = distribution(), ballSpeed = distribution();
let goals = 0, homeWins = 0, draws = 0, passes = 0, failedPasses = 0, shots = 0;
let inPlay = 0, unowned = 0, ballSamples = 0, teleports = 0;
let movingSteps = 0, reversals = 0, pairOverlaps = 0, sampledTicks = 0;
let minSeparation = Infinity, distanceKm = 0, fullOutfieldPlayers = 0;
let freezeTicks = 0, freezeCount = 0, heightSamples = 0, highTicks = 0, maxHeight = 0;
let elapsedMs = 0;
const world = generateWorld(DEFAULT_CLUBS, seededRng(seed));
const fixtures = doubleRoundRobin(Object.keys(world.clubs)).flat();
// Separate match streams: changed RNG consumption in one match cannot alter later matches.
for (let m = 0; m < matches; m++) {
  const fixture = fixtures[m % fixtures.length]!;
  const started = performance.now();
  const state = startEventMatch(world, world.clubs[fixture.homeId]!, world.clubs[fixture.awayId]!, seededRng(seed + 1000 + m));
  const tracks = new Map<string, Track>();
  for (const p of state.players) tracks.set(p.id, {
    x: p.pos.x, y: p.pos.y, dx: 0, dy: 0, previousMoving: false, hasStep: false,
    distance: 0, whole: true, outfield: p.position !== "GK",
  });
  const freezes = new Map<string, Freeze>();
  const awaitingReceipt = new Map<string, string>();
  let eventIndex = 0, matchTicks = 0, steps = 0;
  let bx = state.ball.pos.x, by = state.ball.pos.y;
  while (!isFullTime(state)) {
    if (++steps > 20000) throw new Error(`Match ${m} did not finish within 20000 ticks`);
    const halfReset = state.phase === "half_time";
    stepEventMatch(state);
    const half = state.phase === "first_half" || state.phase === "second_half";
    const measure = half && !halfReset;
    const live = half && !ballDead(state);
    if (half) matchTicks++;
    if (live) {
      inPlay++;
      if (state.ball.ownerId == null) unowned++;
      if (!halfReset) {
        const displacement = Math.hypot(state.ball.pos.x - bx, state.ball.pos.y - by);
        ballSpeed.add(displacement);
        ballSamples++;
        if (displacement > 35) teleports++;
      }
      const height: unknown = (state.ball as unknown as { height?: unknown }).height;
      if (typeof height === "number" && Number.isFinite(height)) {
        heightSamples++;
        maxHeight = Math.max(maxHeight, height);
        if (height > 1) highTicks++;
      }
    }
    bx = state.ball.pos.x; by = state.ball.pos.y;
    const present = new Set(state.players.map(p => p.id));
    for (const [id, track] of tracks) if (!present.has(id)) track.whole = false;
    for (const p of state.players) {
      let track = tracks.get(p.id);
      if (!track) {
        track = { x: p.pos.x, y: p.pos.y, dx: 0, dy: 0, previousMoving: false, hasStep: false, distance: 0, whole: false, outfield: p.position !== "GK" };
        tracks.set(p.id, track);
      }
      if (p.position === "GK") track.outfield = false;
      const dx = p.pos.x - track.x, dy = p.pos.y - track.y;
      const displacement = Math.hypot(dx, dy);
      if (measure) {
        speed.add(displacement);
        if (track.hasStep) accel.add(Math.hypot(dx - track.dx, dy - track.dy));
        if (displacement > 0.5) {
          movingSteps++;
          if (track.previousMoving && dx * track.dx + dy * track.dy < -0.5 * displacement * Math.hypot(track.dx, track.dy)) reversals++;
        }
        track.distance += displacement;
      }
      track.x = p.pos.x; track.y = p.pos.y; track.dx = dx; track.dy = dy;
      track.previousMoving = measure && displacement > 0.5;
      track.hasStep = measure;
    }
    if (measure) {
      sampledTicks++;
      for (let i = 0; i < state.players.length; i++) {
        const a = state.players[i]!;
        for (let j = i + 1; j < state.players.length; j++) {
          const b = state.players[j]!;
          const squared = (a.pos.x - b.pos.x) ** 2 + (a.pos.y - b.pos.y) ** 2;
          if (squared < 0.64) pairOverlaps++;
          if (squared < minSeparation * minSeparation) minSeparation = Math.sqrt(squared);
        }
      }
    }
    // Freeze duration includes the reception tick. A half/substitution boundary
    // censors the observation; it must not be mistaken for voluntary movement.
    for (const [id, freeze] of freezes) {
      const p = state.players.find(p => p.id === id);
      if (!measure || !p) { freezes.delete(id); continue; }
      if (Math.hypot(p.pos.x - freeze.x, p.pos.y - freeze.y) <= 0.5) freeze.ticks++;
      else { freezeTicks += freeze.ticks; freezeCount++; freezes.delete(id); }
    }
    for (; eventIndex < state.events.length; eventIndex++) {
      const e = state.events[eventIndex]!;
      if (e.type === "pass") {
        passes++;
        awaitingReceipt.set(e.receiverId, e.playerId);
      } else if (e.type === "pass_astray" || e.type === "interception") failedPasses++;
      else if (e.type === "shot") {
        shots++;
        if (e.outcome === "goal") goals++;
      }
    }
    // Also works if a future engine emits the pass at launch, before arrival.
    for (const [id, passerId] of awaitingReceipt) {
      if (!live || !present.has(id)) { awaitingReceipt.delete(id); continue; }
      if (state.ball.ownerId === id) {
        const p = state.players.find(p => p.id === id)!;
        freezes.set(id, { x: p.pos.x, y: p.pos.y, ticks: 1 });
        awaitingReceipt.delete(id);
      } else if (state.ball.ownerId != null && state.ball.ownerId !== passerId) awaitingReceipt.delete(id);
    }
  }
  // Score from shot events, not mutable engine score internals.
  let homeGoals = 0, awayGoals = 0;
  for (const e of state.events) if (e.type === "shot" && e.outcome === "goal") {
    if (e.side === "home") homeGoals++; else awayGoals++;
  }
  if (homeGoals > awayGoals) homeWins++;
  if (homeGoals === awayGoals) draws++;
  for (const track of tracks.values()) if (track.whole && track.outfield) {
    distanceKm += track.distance / 1000 * (5400 / Math.max(1, matchTicks));
    fullOutfieldPlayers++;
  }
  elapsedMs += performance.now() - started;
}
const ratio = (n: number, d: number) => d ? n / d : 0;
const acceleration = accel.result();
console.log(JSON.stringify({
  matches, seed,
  goalsPerGame: goals / matches, homeWinPct: 100 * homeWins / matches, drawPct: 100 * draws / matches,
  // Matches calibrate's convention: passesPerTeam counts completions, not attempts.
  passesPerTeam: passes / matches / 2, passCompletion: ratio(passes, passes + failedPasses), shotsPerTeam: shots / matches / 2,
  ballInPlayMin: inPlay / matches / 60, msPerMatch: elapsedMs / matches,
  distancePerOutfieldKm: ratio(distanceKm, fullOutfieldPlayers), fullMatchOutfieldPlayers: fullOutfieldPlayers,
  playerSpeed: speed.result(), playerAccel: { p99: acceleration.p99, max: acceleration.max },
  reversalPct: 100 * ratio(reversals, movingSteps), overlapPerTick: ratio(pairOverlaps, sampledTicks),
  worstOverlapM: Math.max(0, 0.8 - minSeparation), minPlayerSeparationM: Number.isFinite(minSeparation) ? minSeparation : null,
  ballSpeed: { ...ballSpeed.result(), teleportPct: 100 * ratio(teleports, ballSamples) },
  receiverFreezeS: ratio(freezeTicks, freezeCount), receiverFreezeSamples: freezeCount,
  inFlightPct: 100 * ratio(unowned, inPlay),
  ...(heightSamples ? { maxHeight, heightAbove1mPct: 100 * ratio(highTicks, heightSamples) } : {}),
}));

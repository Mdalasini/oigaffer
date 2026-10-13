// A viewer for the scenarios: plays the real simulation at a chosen speed, draws
// between steps, and shows what the player intends and every touch they make.
import { stepBall } from "../src/ball";
import { DT, REACH } from "../src/constants";
import { GOAL_HALF_WIDTH, PITCH_LENGTH, PITCH_WIDTH } from "../src/pitch";
import { SCENARIOS } from "../src/scenarios";
import { step } from "../src/sim";
import { angleDiff, type Vec } from "../src/vec";
import type { World } from "../src/world";

const SPEEDS = [0.25, 0.5, 1, 2] as const;
const PAUSE_AFTER_END = 1.5; // s before the next seed starts
// The attacking half, in metres
const VIEW = { x0: 47, x1: PITCH_LENGTH + 3, y0: -2, y1: PITCH_WIDTH + 2 };
const FOLLOW_SPAN = 36; // m across the shorter side of the view when following the play
const FOLLOW_EASE = 0.08; // share of the way the camera moves towards the play each frame
// Drawn larger than life so they read at this scale
const PLAYER_RADIUS = 0.7;
const BALL_RADIUS = 0.35;

const COLOURS = {
  grass: "#173b26",
  stripe: "#1a4029",
  line: "rgba(238, 241, 230, 0.55)",
  chalk: "#eef1e6",
  dim: "#a9b8a8",
  player: "#f2b33d",
  shadow: "rgba(0, 0, 0, 0.35)",
  control: "#8ec5e6",
  dribble: "#eef1e6",
  shot: "#ff7a6b",
  path: "rgba(238, 241, 230, 0.35)",
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("pitch");
const ctx = canvas.getContext("2d")!;
const scenarioSelect = $<HTMLSelectElement>("scenario");
const seedInput = $<HTMLInputElement>("seed");
const playButton = $<HTMLButtonElement>("play");
const loopBox = $<HTMLInputElement>("loop");
const overlayBox = $<HTMLInputElement>("overlay");
const followBox = $<HTMLInputElement>("follow");
const readout = $<HTMLDListElement>("readout");

interface Snapshot {
  players: { pos: Vec; facing: number }[];
  ball: { pos: Vec; z: number };
}

let world: World;
let prev: Snapshot;
let playing = false;
let speed: number = 1;
let owed = 0; // simulated seconds not yet stepped
let ended = 0; // real seconds since the result

const snapshot = (w: World): Snapshot => ({
  players: w.players.map((p) => ({ pos: { ...p.pos }, facing: p.facing })),
  ball: { pos: { ...w.ball.pos }, z: w.ball.z },
});

function reset() {
  const scenario = SCENARIOS[Number(scenarioSelect.value)]!;
  $("description").textContent = scenario.description;
  world = scenario.setup(Number(seedInput.value) || 0);
  prev = snapshot(world);
  owed = 0;
  ended = 0;
  camera = null;
}

function stepOnce() {
  prev = snapshot(world);
  step(world);
}

function setPlaying(on: boolean) {
  playing = on;
  playButton.textContent = on ? "Pause" : "Play";
}

function nextSeed() {
  seedInput.value = String((Number(seedInput.value) || 0) + 1);
  reset();
}

// ---------- Controls ----------

SCENARIOS.forEach((s, i) => scenarioSelect.add(new Option(s.name, String(i))));
scenarioSelect.onchange = () => reset();
seedInput.onchange = () => reset();
playButton.onclick = () => setPlaying(!playing);
$("step").onclick = () => {
  setPlaying(false);
  stepOnce();
  owed = 0;
};
$("restart").onclick = () => reset();
$("next").onclick = () => nextSeed();

const speedButtons = SPEEDS.map((s) => {
  const b = document.createElement("button");
  b.textContent = `${s}×`;
  b.onclick = () => {
    speed = s;
    speedButtons.forEach((other, i) => other.setAttribute("aria-pressed", String(SPEEDS[i] === s)));
  };
  b.setAttribute("aria-pressed", String(s === speed));
  $("speeds").append(b);
  return b;
});

document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.key === " ") setPlaying(!playing);
  else if (e.key === "ArrowRight") $("step").click();
  else if (e.key === "r" || e.key === "R") reset();
  else if (e.key === "n" || e.key === "N") nextSeed();
  else return;
  e.preventDefault();
});

// ---------- Drawing ----------

let scale = 1; // pixels per metre
let offset = { x: 0, y: 0 };
let camera: Vec | null = null; // centre of view when following, m

function fit() {
  const dpr = devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
}
new ResizeObserver(fit).observe(canvas);

// Either the whole attacking half, or a close view that drifts after the player and ball
function frameView(focus: Vec) {
  if (followBox.checked) {
    camera = camera ? { x: lerp(camera.x, focus.x, FOLLOW_EASE), y: lerp(camera.y, focus.y, FOLLOW_EASE) } : { ...focus };
    scale = Math.min(canvas.width, canvas.height) / FOLLOW_SPAN;
    offset = { x: canvas.width / 2 - camera.x * scale, y: canvas.height / 2 - camera.y * scale };
    return;
  }
  camera = null;
  const w = VIEW.x1 - VIEW.x0;
  const h = VIEW.y1 - VIEW.y0;
  scale = Math.min(canvas.width / w, canvas.height / h);
  offset = { x: (canvas.width - w * scale) / 2 - VIEW.x0 * scale, y: (canvas.height - h * scale) / 2 - VIEW.y0 * scale };
}

const sx = (x: number) => offset.x + x * scale;
const sy = (y: number) => offset.y + y * scale;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function drawPitch() {
  ctx.fillStyle = COLOURS.grass;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // mown stripes every 5.25 m
  ctx.fillStyle = COLOURS.stripe;
  for (let x = 0; x < PITCH_LENGTH; x += 10.5) ctx.fillRect(sx(x), sy(0), 5.25 * scale, PITCH_WIDTH * scale);

  ctx.strokeStyle = COLOURS.line;
  ctx.lineWidth = Math.max(1, 0.15 * scale);
  const mid = PITCH_WIDTH / 2;
  const rect = (x: number, y: number, w: number, h: number) => ctx.strokeRect(sx(x), sy(y), w * scale, h * scale);
  rect(0, 0, PITCH_LENGTH, PITCH_WIDTH);
  ctx.beginPath();
  ctx.moveTo(sx(PITCH_LENGTH / 2), sy(0));
  ctx.lineTo(sx(PITCH_LENGTH / 2), sy(PITCH_WIDTH));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(sx(PITCH_LENGTH / 2), sy(mid), 9.15 * scale, 0, Math.PI * 2);
  ctx.stroke();
  rect(PITCH_LENGTH - 16.5, mid - 20.16, 16.5, 40.32);
  rect(PITCH_LENGTH - 5.5, mid - 9.16, 5.5, 18.32);
  ctx.beginPath();
  ctx.arc(sx(PITCH_LENGTH - 11), sy(mid), 9.15 * scale, Math.PI - 0.93, Math.PI + 0.93);
  ctx.stroke();
  ctx.fillStyle = COLOURS.line;
  ctx.beginPath();
  ctx.arc(sx(PITCH_LENGTH - 11), sy(mid), 0.25 * scale, 0, Math.PI * 2);
  ctx.fill();
  // the goal, behind the line
  ctx.strokeStyle = COLOURS.chalk;
  ctx.lineWidth = Math.max(2, 0.25 * scale);
  rect(PITCH_LENGTH, mid - GOAL_HALF_WIDTH, 2, GOAL_HALF_WIDTH * 2);
}

function drawPredictedPath() {
  const future = { pos: { ...world.ball.pos }, z: world.ball.z, vel: { ...world.ball.vel }, vz: world.ball.vz };
  ctx.fillStyle = COLOURS.path;
  for (let t = 0; t < 4 && Math.hypot(future.vel.x, future.vel.y) > 0.05; t += 0.2) {
    for (let i = 0; i < 4; i++) stepBall(future, DT);
    ctx.beginPath();
    ctx.arc(sx(future.pos.x), sy(future.pos.y - future.z * 0.5), Math.max(1.5, 0.12 * scale), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTouches() {
  for (const t of world.touches) {
    ctx.fillStyle = COLOURS[t.kind];
    ctx.beginPath();
    ctx.arc(sx(t.at.x), sy(t.at.y), Math.max(2, 0.2 * scale), 0, Math.PI * 2);
    ctx.fill();
    if (t.kind === "shot") {
      ctx.strokeStyle = COLOURS.shot;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sx(t.at.x), sy(t.at.y));
      const k = (PITCH_LENGTH + 2 - t.at.x) / Math.max(0.1, t.ballVel.x);
      ctx.lineTo(sx(t.at.x + t.ballVel.x * k), sy(t.at.y + t.ballVel.y * k));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function draw(alpha: number) {
  const p0 = world.players[0];
  const ball = world.ball.pos;
  frameView(p0 ? { x: (p0.pos.x + ball.x) / 2, y: (p0.pos.y + ball.y) / 2 } : ball);
  drawPitch();
  const overlay = overlayBox.checked;
  if (overlay) {
    drawTouches();
    drawPredictedPath();
  }

  world.players.forEach((p, i) => {
    const was = prev.players[i] ?? { pos: p.pos, facing: p.facing };
    const x = lerp(was.pos.x, p.pos.x, alpha);
    const y = lerp(was.pos.y, p.pos.y, alpha);
    const facing = was.facing + angleDiff(was.facing, p.facing) * alpha;

    if (overlay) {
      // reach, and where they're heading or aiming
      ctx.strokeStyle = COLOURS.path;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx(x), sy(y), REACH * scale, 0, Math.PI * 2);
      ctx.stroke();
      const t = p.intent.target;
      const c = 0.5 * scale;
      ctx.strokeStyle = COLOURS.player;
      ctx.beginPath();
      ctx.moveTo(sx(t.x) - c, sy(t.y) - c);
      ctx.lineTo(sx(t.x) + c, sy(t.y) + c);
      ctx.moveTo(sx(t.x) + c, sy(t.y) - c);
      ctx.lineTo(sx(t.x) - c, sy(t.y) + c);
      ctx.stroke();
    }

    ctx.fillStyle = COLOURS.player;
    ctx.beginPath();
    ctx.arc(sx(x), sy(y), PLAYER_RADIUS * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLOURS.grass;
    ctx.lineWidth = Math.max(2, 0.18 * scale);
    ctx.beginPath();
    ctx.moveTo(sx(x), sy(y));
    ctx.lineTo(sx(x + Math.cos(facing) * PLAYER_RADIUS), sy(y + Math.sin(facing) * PLAYER_RADIUS));
    ctx.stroke();

    if (overlay) {
      ctx.fillStyle = COLOURS.chalk;
      ctx.font = `${Math.max(11, 0.9 * scale)}px system-ui, sans-serif`;
      ctx.fillText(p.intent.action, sx(x + 1), sy(y - 1));
      if (p.intent.note) {
        ctx.fillStyle = COLOURS.dim;
        ctx.fillText(p.intent.note, sx(x + 1), sy(y - 1) + Math.max(13, 1.1 * scale));
      }
    }
  });

  // The ball: its shadow on the grass, and the ball lifted by its height
  const bx = lerp(prev.ball.pos.x, world.ball.pos.x, alpha);
  const by = lerp(prev.ball.pos.y, world.ball.pos.y, alpha);
  const bz = lerp(prev.ball.z, world.ball.z, alpha);
  ctx.fillStyle = COLOURS.shadow;
  ctx.beginPath();
  ctx.ellipse(sx(bx), sy(by), BALL_RADIUS * scale, BALL_RADIUS * 0.6 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLOURS.chalk;
  ctx.beginPath();
  ctx.arc(sx(bx), sy(by - bz * 0.5), BALL_RADIUS * (1 + bz / 10) * scale, 0, Math.PI * 2);
  ctx.fill();
}

function showReadout() {
  const p = world.players[0];
  const last = world.touches.at(-1);
  const rows: [string, string][] = [
    ["Time", `${world.time.toFixed(2)} s`],
    ["Result", world.result ? world.result.kind : "—"],
    ["Doing", p ? p.intent.action : "—"],
    ["Speed", p ? `${Math.hypot(p.vel.x, p.vel.y).toFixed(1)} m/s` : "—"],
    ["Ball", `${Math.hypot(world.ball.vel.x, world.ball.vel.y).toFixed(1)} m/s, ${world.ball.z.toFixed(1)} m up`],
    ["Touches", String(world.touches.length)],
    ["Last touch", last ? `${last.kind} at ${last.time.toFixed(2)} s` : "—"],
  ];
  readout.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}

// ---------- Loop ----------

let last = performance.now();
function frame(now: number) {
  // a long gap (hidden tab) shouldn't fast-forward
  const real = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (playing && !world.result) {
    owed += real * speed;
    while (owed >= DT && !world.result) {
      stepOnce();
      owed -= DT;
    }
  } else if (playing && world.result && loopBox.checked) {
    ended += real;
    if (ended >= PAUSE_AFTER_END) nextSeed();
  }
  draw(playing && !world.result ? owed / DT : 1);
  showReadout();
  requestAnimationFrame(frame);
}

reset();
fit();
requestAnimationFrame(frame);

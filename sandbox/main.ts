import { hasComponent } from "bitecs";
import { PITCH_LENGTH, PITCH_WIDTH, TIME_STEP } from "../src/constants";
import { step } from "../src/systems";
import { addBall, addPlayer, createGame, setDribble } from "../src/world";

const GRASS_AROUND_PITCH = 3;
const PLAYER_RADIUS = 0.5;
const BALL_RADIUS = 0.35;
const DESTINATION_MARK_SIZE = 0.6;
const MAX_SECONDS_TO_CATCH_UP = 0.25;

const COLOURS = {
  grass: "#173b26",
  lines: "rgba(238, 241, 230, 0.6)",
  player: "#f2b33d",
  facing: "#102c1c",
  ball: "#eef1e6",
};

const canvas = document.getElementById("pitch") as HTMLCanvasElement;
const readout = document.getElementById("readout")!;
const ctx = canvas.getContext("2d")!;

const world = createGame();
const { Position, Velocity, Facing, Dribble } = world.components;
const player = addPlayer(world, PITCH_LENGTH / 2, PITCH_WIDTH / 2);
const ball = addBall(world, PITCH_LENGTH / 2 + 0.3, PITCH_WIDTH / 2);

let pixelsPerMetre = 1;
const toScreen = (metres: number) => (metres + GRASS_AROUND_PITCH) * pixelsPerMetre;
const toPitch = (cssPixels: number) => (cssPixels * devicePixelRatio) / pixelsPerMetre - GRASS_AROUND_PITCH;
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

function fitPitchToWindow() {
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  pixelsPerMetre = Math.min(
    canvas.width / (PITCH_LENGTH + 2 * GRASS_AROUND_PITCH),
    canvas.height / (PITCH_WIDTH + 2 * GRASS_AROUND_PITCH),
  );
}
addEventListener("resize", fitPitchToWindow);
fitPitchToWindow();

canvas.addEventListener("click", (e) => {
  setDribble(world, player, clamp(toPitch(e.offsetX), PITCH_LENGTH), clamp(toPitch(e.offsetY), PITCH_WIDTH));
});

function drawPitch() {
  ctx.fillStyle = COLOURS.grass;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = COLOURS.lines;
  ctx.lineWidth = Math.max(1, 0.15 * pixelsPerMetre);
  ctx.strokeRect(toScreen(0), toScreen(0), PITCH_LENGTH * pixelsPerMetre, PITCH_WIDTH * pixelsPerMetre);
  ctx.beginPath();
  ctx.moveTo(toScreen(PITCH_LENGTH / 2), toScreen(0));
  ctx.lineTo(toScreen(PITCH_LENGTH / 2), toScreen(PITCH_WIDTH));
  ctx.stroke();
}

function drawDestination() {
  if (!hasComponent(world, player, Dribble)) return;
  const x = toScreen(Dribble.x[player]!);
  const y = toScreen(Dribble.y[player]!);
  const half = DESTINATION_MARK_SIZE * pixelsPerMetre;
  ctx.beginPath();
  ctx.moveTo(x - half, y - half);
  ctx.lineTo(x + half, y + half);
  ctx.moveTo(x + half, y - half);
  ctx.lineTo(x - half, y + half);
  ctx.stroke();
}

function drawPlayer() {
  const x = toScreen(Position.x[player]!);
  const y = toScreen(Position.y[player]!);
  const radius = PLAYER_RADIUS * pixelsPerMetre;
  ctx.fillStyle = COLOURS.player;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLOURS.facing;
  ctx.lineWidth = Math.max(2, 0.15 * pixelsPerMetre);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(Facing[player]!) * radius, y + Math.sin(Facing[player]!) * radius);
  ctx.stroke();
}

function drawBall() {
  ctx.fillStyle = COLOURS.ball;
  ctx.beginPath();
  ctx.arc(toScreen(Position.x[ball]!), toScreen(Position.y[ball]!), BALL_RADIUS * pixelsPerMetre, 0, Math.PI * 2);
  ctx.fill();
}

function showSpeeds() {
  const playerSpeed = Math.hypot(Velocity.x[player]!, Velocity.y[player]!);
  const ballSpeed = Math.hypot(Velocity.x[ball]!, Velocity.y[ball]!);
  readout.textContent = `player ${playerSpeed.toFixed(1)} m/s, ball ${ballSpeed.toFixed(1)} m/s — click anywhere on the pitch to take the ball there.`;
}

let unsimulatedSeconds = 0;
let lastFrame = performance.now();
function frame(now: number) {
  unsimulatedSeconds += Math.min(MAX_SECONDS_TO_CATCH_UP, (now - lastFrame) / 1000);
  lastFrame = now;
  while (unsimulatedSeconds >= TIME_STEP) {
    step(world);
    unsimulatedSeconds -= TIME_STEP;
  }
  drawPitch();
  drawDestination();
  drawPlayer();
  drawBall();
  showSpeeds();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

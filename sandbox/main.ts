// Click to send the player somewhere and watch them run there.
import { hasComponent } from "bitecs";
import { DT, PITCH_LENGTH, PITCH_WIDTH } from "../src/constants";
import { step } from "../src/systems";
import { addPlayer, createGame, setTarget } from "../src/world";

const MARGIN = 3; // m of grass drawn around the pitch

const canvas = document.getElementById("pitch") as HTMLCanvasElement;
const readout = document.getElementById("readout")!;
const ctx = canvas.getContext("2d")!;

const world = createGame();
const { Position, Velocity, Target } = world.components;
const player = addPlayer(world, PITCH_LENGTH / 2, PITCH_WIDTH / 2);

// Metres to pixels, fitting the pitch to the window
let scale = 1;
const toScreen = (m: number) => (m + MARGIN) * scale;
function fit() {
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  scale = Math.min(canvas.width / (PITCH_LENGTH + 2 * MARGIN), canvas.height / (PITCH_WIDTH + 2 * MARGIN));
}
addEventListener("resize", fit);
fit();

canvas.addEventListener("click", (e) => {
  const x = (e.offsetX * devicePixelRatio) / scale - MARGIN;
  const y = (e.offsetY * devicePixelRatio) / scale - MARGIN;
  setTarget(world, player, Math.max(0, Math.min(PITCH_LENGTH, x)), Math.max(0, Math.min(PITCH_WIDTH, y)));
});

function draw() {
  ctx.fillStyle = "#173b26";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(238, 241, 230, 0.6)";
  ctx.lineWidth = Math.max(1, 0.15 * scale);
  ctx.strokeRect(toScreen(0), toScreen(0), PITCH_LENGTH * scale, PITCH_WIDTH * scale);
  ctx.beginPath();
  ctx.moveTo(toScreen(PITCH_LENGTH / 2), toScreen(0));
  ctx.lineTo(toScreen(PITCH_LENGTH / 2), toScreen(PITCH_WIDTH));
  ctx.stroke();

  // where they're heading, until they get there
  if (hasComponent(world, player, Target)) {
    const x = toScreen(Target.x[player]!);
    const y = toScreen(Target.y[player]!);
    const r = 0.6 * scale;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
  }

  ctx.fillStyle = "#f2b33d";
  ctx.beginPath();
  ctx.arc(toScreen(Position.x[player]!), toScreen(Position.y[player]!), 0.8 * scale, 0, Math.PI * 2);
  ctx.fill();

  const speed = Math.hypot(Velocity.x[player]!, Velocity.y[player]!);
  readout.textContent = `${speed.toFixed(1)} m/s — click anywhere on the pitch to send the player there.`;
}

// Fixed simulation steps, however often the screen refreshes
let owed = 0;
let last = performance.now();
function frame(now: number) {
  owed += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (owed >= DT) {
    step(world);
    owed -= DT;
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

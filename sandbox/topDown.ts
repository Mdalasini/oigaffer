import { GOAL_WIDTH, PITCH_LENGTH, PITCH_WIDTH } from "../src/constants";

const GRASS_AROUND_PITCH = 3;
const GOAL_DEPTH = 2;
const PLAYER_RADIUS = 0.5;
const BALL_RADIUS = 0.35;
const BALL_GROWTH_PER_METRE_UP = 0.08;
const CROSS_SIZE = 0.6;

export const COLOURS = {
  grass: "#173b26",
  lines: "rgba(238, 241, 230, 0.6)",
  player: "#f2b33d",
  keeper: "#5bb0ef",
  facing: "#102c1c",
  ball: "#eef1e6",
  shadow: "rgba(0, 0, 0, 0.35)",
  aim: "#ef6b5b",
};

export type PitchArea = { fromX: number; toX: number };
export const WHOLE_PITCH: PitchArea = { fromX: 0, toX: PITCH_LENGTH };

export function createTopDown(canvas: HTMLCanvasElement, area: PitchArea = WHOLE_PITCH) {
  const ctx = canvas.getContext("2d")!;
  let pixelsPerMetre = 1;
  const left = area.fromX - GRASS_AROUND_PITCH;
  const screenX = (x: number) => (x - left) * pixelsPerMetre;
  const screenY = (y: number) => (y + GRASS_AROUND_PITCH) * pixelsPerMetre;
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

  function fit() {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    pixelsPerMetre = Math.min(
      canvas.width / (area.toX - area.fromX + 2 * GRASS_AROUND_PITCH),
      canvas.height / (PITCH_WIDTH + 2 * GRASS_AROUND_PITCH),
    );
  }

  function pitchAt(e: MouseEvent): [number, number] {
    const x = (e.offsetX * devicePixelRatio) / pixelsPerMetre + left;
    const y = (e.offsetY * devicePixelRatio) / pixelsPerMetre - GRASS_AROUND_PITCH;
    return [clamp(x, PITCH_LENGTH), clamp(y, PITCH_WIDTH)];
  }

  function drawPitch() {
    ctx.fillStyle = COLOURS.grass;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = COLOURS.lines;
    ctx.lineWidth = Math.max(1, 0.15 * pixelsPerMetre);
    ctx.strokeRect(screenX(0), screenY(0), PITCH_LENGTH * pixelsPerMetre, PITCH_WIDTH * pixelsPerMetre);
    ctx.beginPath();
    ctx.moveTo(screenX(PITCH_LENGTH / 2), screenY(0));
    ctx.lineTo(screenX(PITCH_LENGTH / 2), screenY(PITCH_WIDTH));
    ctx.stroke();
    const postY = screenY((PITCH_WIDTH - GOAL_WIDTH) / 2);
    ctx.strokeRect(screenX(-GOAL_DEPTH), postY, GOAL_DEPTH * pixelsPerMetre, GOAL_WIDTH * pixelsPerMetre);
    ctx.strokeRect(screenX(PITCH_LENGTH), postY, GOAL_DEPTH * pixelsPerMetre, GOAL_WIDTH * pixelsPerMetre);
  }

  function drawCross(x: number, y: number) {
    const half = CROSS_SIZE * pixelsPerMetre;
    ctx.beginPath();
    ctx.moveTo(screenX(x) - half, screenY(y) - half);
    ctx.lineTo(screenX(x) + half, screenY(y) + half);
    ctx.moveTo(screenX(x) + half, screenY(y) - half);
    ctx.lineTo(screenX(x) - half, screenY(y) + half);
    ctx.stroke();
  }

  function drawLine(fromX: number, fromY: number, toX: number, toY: number, colour: string) {
    ctx.strokeStyle = colour;
    ctx.setLineDash([0.5 * pixelsPerMetre, 0.5 * pixelsPerMetre]);
    ctx.beginPath();
    ctx.moveTo(screenX(fromX), screenY(fromY));
    ctx.lineTo(screenX(toX), screenY(toY));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawPlayer(x: number, y: number, facing: number, colour = COLOURS.player) {
    const radius = PLAYER_RADIUS * pixelsPerMetre;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(screenX(x), screenY(y), radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLOURS.facing;
    ctx.lineWidth = Math.max(2, 0.15 * pixelsPerMetre);
    ctx.beginPath();
    ctx.moveTo(screenX(x), screenY(y));
    ctx.lineTo(screenX(x) + Math.cos(facing) * radius, screenY(y) + Math.sin(facing) * radius);
    ctx.stroke();
  }

  function drawBall(x: number, y: number, z: number) {
    const radius = BALL_RADIUS * pixelsPerMetre;
    ctx.fillStyle = COLOURS.shadow;
    ctx.beginPath();
    ctx.ellipse(screenX(x), screenY(y), radius, radius * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLOURS.ball;
    ctx.beginPath();
    ctx.arc(screenX(x), screenY(y) - z * pixelsPerMetre, radius * (1 + BALL_GROWTH_PER_METRE_UP * z), 0, Math.PI * 2);
    ctx.fill();
  }

  return { fit, pitchAt, drawPitch, drawCross, drawLine, drawPlayer, drawBall };
}

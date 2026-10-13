import {
  BLOCKING_REACH,
  CROSSBAR_HEIGHT,
  GOAL_WIDTH,
  HIGHEST_BLOCK,
  KEEPER_HIGHEST_REACH,
  KEEPER_REACH,
  PITCH_LENGTH,
  PITCH_WIDTH,
} from "../src/constants";
import type { Point } from "../src/shooting";
import { COLOURS } from "./topDown";

const EYE_HEIGHT = 1.7;
const CAMERA_BEHIND_BALL = 3;
const FIELD_OF_VIEW = (45 * Math.PI) / 180;
const HORIZON_FROM_TOP = 0.4;
const NEAREST_VISIBLE = 0.2;
const BALL_RADIUS = 0.11;
const GOAL_DEPTH = 2;
const PENALTY_AREA = { depth: 16.5, width: 40.32 };
const GOAL_AREA = { depth: 5.5, width: 18.32 };
const KEEPER_HALF_WIDTH = 0.25;
const KEEPER_HEIGHT = 1.9;
const PLAYER_HALF_WIDTH = 0.25;
const PLAYER_HEIGHT = 1.8;
const LYING_HALF_WIDTH = 0.9;
const LYING_HEIGHT = 0.3;

const SKY = "#0c2234";

type Defender = { at: [x: number, y: number]; grounded: boolean };


export function createPlayerView(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  let focal = 1;
  let camera: Point = [0, 0, EYE_HEIGHT];
  let forward: [number, number] = [1, 0];
  const right = (): [number, number] => [-forward[1], forward[0]];
  const centreX = () => canvas.width / 2;
  const horizon = () => canvas.height * HORIZON_FROM_TOP;

  function fit() {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    focal = canvas.width / (2 * Math.tan(FIELD_OF_VIEW / 2));
  }

  function standBehind(ballX: number, ballY: number) {
    const dx = PITCH_LENGTH - ballX;
    const dy = PITCH_WIDTH / 2 - ballY;
    const length = Math.hypot(dx, dy) || 1;
    forward = [dx / length, dy / length];
    camera = [ballX - forward[0] * CAMERA_BEHIND_BALL, ballY - forward[1] * CAMERA_BEHIND_BALL, EYE_HEIGHT];
  }

  function depthOf([x, y]: Point) {
    return (x - camera[0]) * forward[0] + (y - camera[1]) * forward[1];
  }

  function project(point: Point): [number, number, number] {
    const [x, y, z] = point;
    const depth = depthOf(point);
    const across = (x - camera[0]) * right()[0] + (y - camera[1]) * right()[1];
    return [centreX() + (focal * across) / depth, horizon() - (focal * (z - camera[2])) / depth, depth];
  }

  function aimAt(e: MouseEvent): [number, number] | null {
    const across = (e.offsetX * devicePixelRatio - centreX()) / focal;
    const up = (horizon() - e.offsetY * devicePixelRatio) / focal;
    const rayX = forward[0] + right()[0] * across;
    const rayY = forward[1] + right()[1] * across;
    const distance = (PITCH_LENGTH - camera[0]) / rayX;
    if (!(distance > 0)) return null;
    return [camera[1] + rayY * distance, Math.max(0, camera[2] + up * distance)];
  }

  function line(from: Point, to: Point) {
    const fromDepth = depthOf(from);
    const toDepth = depthOf(to);
    if (fromDepth < NEAREST_VISIBLE && toDepth < NEAREST_VISIBLE) return;
    const clip = (a: Point, b: Point, aDepth: number, bDepth: number): Point => {
      if (aDepth >= NEAREST_VISIBLE) return a;
      const share = (NEAREST_VISIBLE - aDepth) / (bDepth - aDepth);
      return [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share, a[2] + (b[2] - a[2]) * share];
    };
    const [x1, y1] = project(clip(from, to, fromDepth, toDepth));
    const [x2, y2] = project(clip(to, from, toDepth, fromDepth));
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function box(depth: number, width: number) {
    const near = PITCH_LENGTH - depth;
    const top = (PITCH_WIDTH - width) / 2;
    const bottom = (PITCH_WIDTH + width) / 2;
    line([near, top, 0], [near, bottom, 0]);
    line([near, top, 0], [PITCH_LENGTH, top, 0]);
    line([near, bottom, 0], [PITCH_LENGTH, bottom, 0]);
  }

  function drawGround() {
    ctx.fillStyle = SKY;
    ctx.fillRect(0, 0, canvas.width, horizon());
    ctx.fillStyle = COLOURS.grass;
    ctx.fillRect(0, horizon(), canvas.width, canvas.height - horizon());
    ctx.strokeStyle = COLOURS.lines;
    ctx.lineWidth = Math.max(1, devicePixelRatio);
    line([PITCH_LENGTH, 0, 0], [PITCH_LENGTH, PITCH_WIDTH, 0]);
    box(PENALTY_AREA.depth, PENALTY_AREA.width);
    box(GOAL_AREA.depth, GOAL_AREA.width);
  }

  function drawGoal() {
    const near = (PITCH_WIDTH - GOAL_WIDTH) / 2;
    const far = (PITCH_WIDTH + GOAL_WIDTH) / 2;
    const back = PITCH_LENGTH + GOAL_DEPTH;
    ctx.strokeStyle = COLOURS.lines;
    ctx.lineWidth = devicePixelRatio;
    line([back, near, 0], [back, far, 0]);
    line([back, near, CROSSBAR_HEIGHT], [back, far, CROSSBAR_HEIGHT]);
    for (const post of [near, far]) {
      line([PITCH_LENGTH, post, CROSSBAR_HEIGHT], [back, post, CROSSBAR_HEIGHT]);
      line([back, post, 0], [back, post, CROSSBAR_HEIGHT]);
    }
    ctx.strokeStyle = COLOURS.ball;
    ctx.lineWidth = Math.max(2, (0.12 * focal) / depthOf([PITCH_LENGTH, PITCH_WIDTH / 2, 0]));
    line([PITCH_LENGTH, near, 0], [PITCH_LENGTH, near, CROSSBAR_HEIGHT]);
    line([PITCH_LENGTH, far, 0], [PITCH_LENGTH, far, CROSSBAR_HEIGHT]);
    line([PITCH_LENGTH, near, CROSSBAR_HEIGHT], [PITCH_LENGTH, far, CROSSBAR_HEIGHT]);
  }

  function upright(x: number, y: number, halfWidth: number, height: number): Point[] {
    const [acrossX, acrossY] = right();
    return [
      [x - acrossX * halfWidth, y - acrossY * halfWidth, 0],
      [x - acrossX * halfWidth, y - acrossY * halfWidth, height],
      [x + acrossX * halfWidth, y + acrossY * halfWidth, height],
      [x + acrossX * halfWidth, y + acrossY * halfWidth, 0],
    ];
  }

  function drawBody(body: Point[], colour: string) {
    if (body.some((corner) => depthOf(corner) < NEAREST_VISIBLE)) return false;
    ctx.fillStyle = colour;
    ctx.beginPath();
    for (const corner of body) {
      const [screenX, screenY] = project(corner);
      ctx.lineTo(screenX, screenY);
    }
    ctx.fill();
    return true;
  }

  function drawReach(reach: Point[], colour: string) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = devicePixelRatio;
    ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
    reach.slice(1).forEach((corner, i) => line(reach[i]!, corner));
    ctx.setLineDash([]);
  }

  function drawKeeper([x, y]: [number, number]) {
    if (drawBody(upright(x, y, KEEPER_HALF_WIDTH, KEEPER_HEIGHT), COLOURS.keeper)) {
      drawReach(upright(x, y, KEEPER_REACH, KEEPER_HIGHEST_REACH), COLOURS.keeper);
    }
  }

  function drawDefender({ at: [x, y], grounded }: Defender) {
    if (grounded) drawBody(upright(x, y, LYING_HALF_WIDTH, LYING_HEIGHT), COLOURS.defender);
    else if (drawBody(upright(x, y, PLAYER_HALF_WIDTH, PLAYER_HEIGHT), COLOURS.defender)) {
      drawReach(upright(x, y, BLOCKING_REACH, HIGHEST_BLOCK), COLOURS.defender);
    }
  }

  function drawCircle(points: Point[]) {
    ctx.strokeStyle = COLOURS.aim;
    ctx.lineWidth = devicePixelRatio;
    points.forEach((point, i) => line(point, points[(i + 1) % points.length]!));
  }

  function drawAim([aimX, y, z]: Point) {
    const [x, screenY, depth] = project([aimX, y, z]);
    if (depth < NEAREST_VISIBLE) return;
    const half = 6 * devicePixelRatio;
    ctx.strokeStyle = COLOURS.aim;
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.beginPath();
    ctx.moveTo(x - half, screenY - half);
    ctx.lineTo(x + half, screenY + half);
    ctx.moveTo(x + half, screenY - half);
    ctx.lineTo(x - half, screenY + half);
    ctx.stroke();
  }

  function drawTrail(trail: Point[]) {
    ctx.fillStyle = COLOURS.aim;
    for (const point of trail) {
      const [x, y, depth] = project(point);
      if (depth < NEAREST_VISIBLE) continue;
      ctx.fillRect(x - devicePixelRatio, y - devicePixelRatio, 2 * devicePixelRatio, 2 * devicePixelRatio);
    }
  }

  function drawBall(ball: Point) {
    const depth = depthOf(ball);
    if (depth < NEAREST_VISIBLE) return;
    const radius = Math.max(2, (BALL_RADIUS * focal) / depth);
    const [shadowX, shadowY] = project([ball[0], ball[1], 0]);
    ctx.fillStyle = COLOURS.shadow;
    ctx.beginPath();
    ctx.ellipse(shadowX, shadowY, radius, radius * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    const [x, y] = project(ball);
    ctx.fillStyle = COLOURS.ball;
    ctx.beginPath();
    ctx.arc(x, y - radius, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawTeammate([x, y]: [number, number]) {
    drawBody(upright(x, y, PLAYER_HALF_WIDTH, PLAYER_HEIGHT), COLOURS.player);
  }

  function draw(
    ball: Point,
    trail: Point[],
    aim: Point,
    circle: Point[],
    keeper: [x: number, y: number] | null,
    defenders: Defender[] = [],
    teammates: [x: number, y: number][] = [],
  ) {
    drawGround();
    drawGoal();
    if (keeper !== null) drawKeeper(keeper);
    const figures = [
      ...defenders.map((defender) => ({ at: defender.at, draw: () => drawDefender(defender) })),
      ...teammates.map((at) => ({ at, draw: () => drawTeammate(at) })),
    ];
    figures.sort((a, b) => depthOf([...b.at, 0]) - depthOf([...a.at, 0])).forEach((figure) => figure.draw());
    drawTrail(trail);
    drawCircle(circle);
    drawAim(aim);
    drawBall(ball);
  }

  return { fit, standBehind, aimAt, draw };
}

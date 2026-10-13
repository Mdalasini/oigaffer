import { hasComponent, removeComponent } from "bitecs";
import { useEffect, useRef, useState } from "react";
import {
  AVERAGE_SHOOTING_GRADE,
  BEST_SHOOTING_GRADE,
  CROSSBAR_HEIGHT,
  GOAL_WIDTH,
  MAX_SHOT_SPEED,
  PITCH_LENGTH,
  PITCH_WIDTH,
  WORST_SHOOTING_GRADE,
} from "../../src/constants";
import { acrossTheShot, neededShotSpeed, spreadRadius, type Point } from "../../src/shooting";
import { isGoal } from "../../src/systems";
import { addBall, addPlayer, createGame, setShot } from "../../src/world";
import { runEveryFrame } from "../frames";
import { createPlayerView } from "../playerView";
import { COLOURS, createTopDown } from "../topDown";

const ATTACKING_END = { fromX: 60, toX: PITCH_LENGTH };
const FIRST_SPOT: [number, number] = [88, PITCH_WIDTH / 2 - 4];
const FIRST_AIM: [number, number] = [PITCH_WIDTH / 2 + 2, 1.2];
const PLAYER_BEHIND_BALL = 0.3;
const LONGEST_TRAIL = 600;
const POINTS_ON_CIRCLE = 48;
const FIRST_POWER = 50;

type Sandbox = ReturnType<typeof runShootingSandbox>;
type Settings = { grade: number; power: number };

export function ShootingView() {
  const topDownRef = useRef<HTMLCanvasElement>(null);
  const playerViewRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLParagraphElement>(null);
  const sandbox = useRef<Sandbox>(null);
  const [grade, setGrade] = useState(AVERAGE_SHOOTING_GRADE);
  const [power, setPower] = useState(FIRST_POWER);

  useEffect(() => {
    const running = runShootingSandbox(topDownRef.current!, playerViewRef.current!, readoutRef.current!);
    sandbox.current = running;
    return running.stop;
  }, []);

  useEffect(() => sandbox.current?.change({ grade, power }), [grade, power]);

  return (
    <div className="shooting">
      <div className="split">
        <section>
          <canvas ref={topDownRef} />
          <h2>From above: click to move the ball</h2>
        </section>
        <section>
          <canvas ref={playerViewRef} />
          <h2>Shooter's view: click to aim</h2>
        </section>
      </div>
      <form
        className="controls"
        onSubmit={(e) => {
          e.preventDefault();
          sandbox.current?.shoot();
        }}
      >
        <label>
          Shooting grade
          <input
            type="range"
            min={WORST_SHOOTING_GRADE}
            max={BEST_SHOOTING_GRADE}
            value={grade}
            onChange={(e) => setGrade(Number(e.target.value))}
          />
          {grade}
        </label>
        <label>
          Power
          <input type="range" min={0} max={100} value={power} onChange={(e) => setPower(Number(e.target.value))} />
          {power === 0 ? "just enough" : power === 100 ? "full" : `${power}%`}
        </label>
        <button type="submit">Shoot</button>
        <p ref={readoutRef} />
      </form>
    </div>
  );
}

const sideOf = (y: number) => (y < PITCH_WIDTH / 2 ? "left" : "right");

function describePoint(y: number, z: number): string {
  return `${Math.abs(y - PITCH_WIDTH / 2).toFixed(1)} m ${sideOf(y)} of centre, ${z.toFixed(1)} m up`;
}

function describeCrossing(y: number, z: number): string {
  const side = sideOf(y);
  if (isGoal(y, z)) return `Goal: ${describePoint(y, z)}`;
  if (Math.abs(y - PITCH_WIDTH / 2) < GOAL_WIDTH / 2) return `Over the bar: ${(z - CROSSBAR_HEIGHT).toFixed(1)} m too high`;
  return `Wide: ${(Math.abs(y - PITCH_WIDTH / 2) - GOAL_WIDTH / 2).toFixed(1)} m outside the ${side} post`;
}

function runShootingSandbox(topDownCanvas: HTMLCanvasElement, playerCanvas: HTMLCanvasElement, readout: HTMLElement) {
  const world = createGame();
  const { Position, Velocity, Facing, Shooting, Shot, Target, GoalLineCrossing } = world.components;
  const player = addPlayer(world, 0, 0);
  const ball = addBall(world, 0, 0);
  const topDown = createTopDown(topDownCanvas, ATTACKING_END);
  const playerView = createPlayerView(playerCanvas);
  let spot = FIRST_SPOT;
  let aim = FIRST_AIM;
  let settings: Settings = { grade: AVERAGE_SHOOTING_GRADE, power: FIRST_POWER };
  let trail: Point[] = [];
  let shotTaken = false;

  const spotPoint = (): Point => [spot[0], spot[1], 0];
  const aimPoint = (): Point => [PITCH_LENGTH, aim[0], aim[1]];

  function plannedShot() {
    const needed = neededShotSpeed(spotPoint(), aimPoint());
    const least = Math.min(needed, MAX_SHOT_SPEED);
    const speed = least + (settings.power / 100) * (MAX_SHOT_SPEED - least);
    const radius = spreadRadius(settings.grade, spotPoint(), aimPoint(), speed);
    return { needed, speed, radius };
  }

  function circleAroundAim(radius: number): Point[] {
    const [acrossX, acrossY] = acrossTheShot(spotPoint(), aimPoint());
    const [x, y, z] = aimPoint();
    return Array.from({ length: POINTS_ON_CIRCLE }, (_, i) => {
      const angle = (i / POINTS_ON_CIRCLE) * 2 * Math.PI;
      const across = radius * Math.cos(angle);
      return [x + acrossX * across, y + acrossY * across, z + radius * Math.sin(angle)];
    });
  }

  function placeBallOnSpot() {
    const [x, y] = spot;
    const facing = Math.atan2(aim[0] - y, PITCH_LENGTH - x);
    Position.x[ball] = x;
    Position.y[ball] = y;
    Position.z[ball] = 0;
    Velocity.x[ball] = 0;
    Velocity.y[ball] = 0;
    Velocity.z[ball] = 0;
    Position.x[player] = x - Math.cos(facing) * PLAYER_BEHIND_BALL;
    Position.y[player] = y - Math.sin(facing) * PLAYER_BEHIND_BALL;
    Velocity.x[player] = 0;
    Velocity.y[player] = 0;
    Facing[player] = facing;
    removeComponent(world, player, Shot);
    removeComponent(world, player, Target);
    removeComponent(world, ball, GoalLineCrossing);
    trail = [];
    shotTaken = false;
    playerView.standBehind(x, y);
  }

  function shoot() {
    placeBallOnSpot();
    Shooting[player] = settings.grade;
    setShot(world, player, ...aimPoint(), plannedShot().speed);
    shotTaken = true;
  }

  function moveSpot(e: MouseEvent) {
    spot = topDown.pitchAt(e);
    placeBallOnSpot();
  }

  function moveAim(e: MouseEvent) {
    aim = playerView.aimAt(e) ?? aim;
    if (!shotTaken) placeBallOnSpot();
  }

  function describePlan(): string {
    const { needed, speed, radius } = plannedShot();
    if (needed > MAX_SHOT_SPEED) return `out of range: needs ${needed.toFixed(1)} m/s, the most is ${MAX_SHOT_SPEED} m/s`;
    return `needs ${needed.toFixed(1)} m/s, striking at ${speed.toFixed(1)} m/s, circle radius ${radius.toFixed(2)} m`;
  }

  function describeShot(): string {
    if (hasComponent(world, ball, GoalLineCrossing)) return describeCrossing(GoalLineCrossing.y[ball]!, GoalLineCrossing.z[ball]!);
    if (hasComponent(world, player, Shot)) return "Running up…";
    const speed = Math.hypot(Velocity.x[ball]!, Velocity.y[ball]!, Velocity.z[ball]!);
    if (shotTaken && speed === 0) return "Fell short";
    if (shotTaken) return `Ball ${speed.toFixed(1)} m/s, ${Position.z[ball]!.toFixed(1)} m up`;
    return `Aiming ${describePoint(...aim)}`;
  }

  function holdBallWhereItCrossed() {
    if (!hasComponent(world, ball, GoalLineCrossing)) return;
    Position.x[ball] = PITCH_LENGTH;
    Position.y[ball] = GoalLineCrossing.y[ball]!;
    Position.z[ball] = GoalLineCrossing.z[ball]!;
    Velocity.x[ball] = 0;
    Velocity.y[ball] = 0;
    Velocity.z[ball] = 0;
  }

  function draw() {
    holdBallWhereItCrossed();
    const ballAt: Point = [Position.x[ball]!, Position.y[ball]!, Position.z[ball]!];
    if (shotTaken && !hasComponent(world, player, Shot) && trail.length < LONGEST_TRAIL) trail.push(ballAt);
    topDown.drawPitch();
    topDown.drawLine(spot[0], spot[1], PITCH_LENGTH, aim[0], COLOURS.aim);
    topDown.drawPlayer(Position.x[player]!, Position.y[player]!, Facing[player]!);
    topDown.drawBall(...ballAt);
    playerView.draw(ballAt, trail, aimPoint(), circleAroundAim(plannedShot().radius));
    readout.textContent = `${describeShot()} — ${describePlan()}`;
  }

  function fit() {
    topDown.fit();
    playerView.fit();
  }

  fit();
  placeBallOnSpot();
  addEventListener("resize", fit);
  topDownCanvas.addEventListener("click", moveSpot);
  playerCanvas.addEventListener("click", moveAim);
  const stopFrames = runEveryFrame(world, draw);

  return {
    shoot,
    change(newSettings: Settings) {
      settings = newSettings;
    },
    stop() {
      stopFrames();
      removeEventListener("resize", fit);
      topDownCanvas.removeEventListener("click", moveSpot);
      playerCanvas.removeEventListener("click", moveAim);
    },
  };
}

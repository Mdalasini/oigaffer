import { hasComponent } from "bitecs";
import { useEffect, useRef } from "react";
import { PITCH_LENGTH, PITCH_WIDTH } from "../../src/constants";
import { addBall, addPlayer, createGame, setDribble } from "../../src/world";
import { runEveryFrame } from "../frames";
import { createTopDown } from "../topDown";

export function DribbleView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => runDribbleSandbox(canvasRef.current!, readoutRef.current!), []);
  return (
    <div className="fill">
      <canvas ref={canvasRef} />
      <p className="readout" ref={readoutRef} />
    </div>
  );
}

function runDribbleSandbox(canvas: HTMLCanvasElement, readout: HTMLElement): () => void {
  const world = createGame();
  const { Position, Velocity, Facing, Dribble } = world.components;
  const player = addPlayer(world, PITCH_LENGTH / 2, PITCH_WIDTH / 2);
  const ball = addBall(world, PITCH_LENGTH / 2 + 0.3, PITCH_WIDTH / 2);
  const view = createTopDown(canvas);

  function dribbleToClick(e: MouseEvent) {
    setDribble(world, player, ...view.pitchAt(e));
  }

  function draw() {
    view.drawPitch();
    if (hasComponent(world, player, Dribble)) view.drawCross(Dribble.x[player]!, Dribble.y[player]!);
    view.drawPlayer(Position.x[player]!, Position.y[player]!, Facing[player]!);
    view.drawBall(Position.x[ball]!, Position.y[ball]!, Position.z[ball]!);
    const playerSpeed = Math.hypot(Velocity.x[player]!, Velocity.y[player]!);
    const ballSpeed = Math.hypot(Velocity.x[ball]!, Velocity.y[ball]!);
    readout.textContent = `player ${playerSpeed.toFixed(1)} m/s, ball ${ballSpeed.toFixed(1)} m/s — click anywhere on the pitch to take the ball there.`;
  }

  view.fit();
  addEventListener("resize", view.fit);
  canvas.addEventListener("click", dribbleToClick);
  const stopFrames = runEveryFrame(world, draw);

  return () => {
    stopFrames();
    removeEventListener("resize", view.fit);
    canvas.removeEventListener("click", dribbleToClick);
  };
}

import { hasComponent } from "bitecs";
import { useEffect, useRef } from "react";
import { AVERAGE_SHOOTING_GRADE, PITCH_LENGTH, TOUCH_REACH } from "../../src/constants";
import { GOAL_CENTRE, isGoal } from "../../src/goal";
import type { Point } from "../../src/shooting";
import { addBall, addGoalkeeper, addPlayer, addTeam, createGame, joinTeam, setAttacking, type Game } from "../../src/world";
import { circleAroundAim, holdBallWhereItCrossed, percent } from "../attackingRound";
import { runEveryFrame } from "../frames";
import { createPlayerView } from "../playerView";
import { COLOURS, createTopDown } from "../topDown";

const ATTACKING_END = { fromX: 60, toX: PITCH_LENGTH };
const NEAREST_START = 15;
const FURTHEST_START = 35;
const WIDEST_START = 20;
const PAUSE_BETWEEN_ROUNDS = 1500;
const LONGEST_ROUND = 15;
const LONGEST_TRAIL = 600;

type Outcome = "Goal" | "Saved" | "Claimed at the attacker's feet" | "Wide or over" | "Fell short" | "Ran out of time";
type Tally = Record<Outcome, number>;

export function OneOnOneView() {
  const topDownRef = useRef<HTMLCanvasElement>(null);
  const playerViewRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLParagraphElement>(null);
  const tallyRef = useRef<HTMLParagraphElement>(null);

  useEffect(
    () => runOneOnOnes(topDownRef.current!, playerViewRef.current!, readoutRef.current!, tallyRef.current!),
    [],
  );

  return (
    <div className="shooting">
      <div className="split">
        <section>
          <canvas ref={topDownRef} />
          <h2>From above</h2>
        </section>
        <section>
          <canvas ref={playerViewRef} />
          <h2>Behind the ball</h2>
        </section>
      </div>
      <div className="controls">
        <p ref={readoutRef} />
        <p ref={tallyRef} />
      </div>
    </div>
  );
}

function randomStart(): [number, number] {
  const distance = NEAREST_START + Math.random() * (FURTHEST_START - NEAREST_START);
  return [PITCH_LENGTH - distance, GOAL_CENTRE + (Math.random() * 2 - 1) * WIDEST_START];
}

function setUpRound() {
  const world = createGame(Math.floor(Math.random() * 2 ** 31));
  const [x, y] = randomStart();
  const facing = Math.atan2(GOAL_CENTRE - y, PITCH_LENGTH - x);
  const [attackers, defenders] = [addTeam(world), addTeam(world)];
  const attacker = joinTeam(world, addPlayer(world, x - Math.cos(facing) * TOUCH_REACH * 0.5, y - Math.sin(facing) * TOUCH_REACH * 0.5, facing, AVERAGE_SHOOTING_GRADE), attackers);
  const ball = addBall(world, x, y);
  const keeper = joinTeam(world, addGoalkeeper(world, PITCH_LENGTH, GOAL_CENTRE), defenders);
  setAttacking(world, attacker);
  return { world, attacker, ball, keeper, startedAt: performance.now() };
}

function outcomeOf(world: Game, ball: number, shotTaken: boolean, seconds: number): Outcome | null {
  const { GoalLineCrossing, Held, Velocity } = world.components;
  if (hasComponent(world, ball, Held)) return shotTaken ? "Saved" : "Claimed at the attacker's feet";
  if (hasComponent(world, ball, GoalLineCrossing)) return isGoal(GoalLineCrossing.y[ball]!, GoalLineCrossing.z[ball]!) ? "Goal" : "Wide or over";
  if (shotTaken && Velocity.x[ball] === 0 && Velocity.y[ball] === 0) return "Fell short";
  if (seconds > LONGEST_ROUND) return "Ran out of time";
  return null;
}

function runOneOnOnes(topDownCanvas: HTMLCanvasElement, playerCanvas: HTMLCanvasElement, readout: HTMLElement, tallyOut: HTMLElement) {
  const topDown = createTopDown(topDownCanvas, ATTACKING_END);
  const playerView = createPlayerView(playerCanvas);
  const tally: Tally = { Goal: 0, Saved: 0, "Claimed at the attacker's feet": 0, "Wide or over": 0, "Fell short": 0, "Ran out of time": 0 };
  let round = 0;
  let stopFrames = () => {};
  let nextRound = 0;

  function play() {
    round++;
    const { world, attacker, ball, keeper, startedAt } = setUpRound();
    const { Position, Facing, Attacking, Struck, Target } = world.components;
    const trail: Point[] = [];
    let shot: { from: Point; chance: number; aim: Point } | null = null;
    let outcome: Outcome | null = null;
    let aim: Point = [PITCH_LENGTH, GOAL_CENTRE, 1];
    let chance = 0;
    let furtherOn = 0;

    function describe(): string {
      if (outcome && shot) return `${outcome}, from a ${percent(shot.chance)} chance ${(PITCH_LENGTH - shot.from[0]).toFixed(0)} m out`;
      if (outcome) return outcome;
      if (shot) return `Shot! ${percent(shot.chance)} chance from ${(PITCH_LENGTH - shot.from[0]).toFixed(0)} m out`;
      if (Number.isNaN(Attacking.aimY[attacker]!)) return "Through on goal…";
      return `Carrying the ball in: ${percent(chance)} if they shoot now, up to ${percent(furtherOn)} further on`;
    }

    function draw() {
      const seconds = (performance.now() - startedAt) / 1000;
      holdBallWhereItCrossed(world, ball);
      const ballAt: Point = [Position.x[ball]!, Position.y[ball]!, Position.z[ball]!];
      if (hasComponent(world, attacker, Attacking) && !Number.isNaN(Attacking.aimY[attacker]!)) {
        aim = [PITCH_LENGTH, Attacking.aimY[attacker]!, Attacking.aimZ[attacker]!];
        chance = Attacking.chance[attacker]!;
        furtherOn = Attacking.bestChanceFurtherOn[attacker]!;
      }
      if (!shot && hasComponent(world, ball, Struck)) shot = { from: ballAt, chance, aim };
      if (shot && trail.length < LONGEST_TRAIL) trail.push(ballAt);
      if (!outcome) {
        outcome = outcomeOf(world, ball, shot !== null, seconds);
        if (outcome) {
          tally[outcome]++;
          nextRound = window.setTimeout(restart, PAUSE_BETWEEN_ROUNDS);
        }
      }

      topDown.drawPitch();
      if (!shot) topDown.drawLine(ballAt[0], ballAt[1], aim[0], aim[1], COLOURS.aim);
      if (hasComponent(world, keeper, Target)) {
        topDown.drawLine(Position.x[keeper]!, Position.y[keeper]!, world.components.Target.x[keeper]!, world.components.Target.y[keeper]!, COLOURS.keeper);
      }
      topDown.drawPlayer(Position.x[attacker]!, Position.y[attacker]!, Facing[attacker]!);
      topDown.drawPlayer(Position.x[keeper]!, Position.y[keeper]!, Facing[keeper]!, COLOURS.keeper);
      topDown.drawBall(...ballAt);

      const behind = shot ? shot.from : ballAt;
      playerView.standBehind(behind[0], behind[1]);
      playerView.draw(ballAt, trail, shot ? shot.aim : aim, shot ? [] : circleAroundAim(AVERAGE_SHOOTING_GRADE, ballAt, aim), [Position.x[keeper]!, Position.y[keeper]!]);

      readout.textContent = `Round ${round}: ${describe()}`;
      tallyOut.textContent = Object.entries(tally)
        .filter(([, count]) => count > 0)
        .map(([name, count]) => `${name} ${count}`)
        .join(" · ");
    }

    stopFrames = runEveryFrame(world, draw);
  }

  function restart() {
    stopFrames();
    play();
  }

  function fit() {
    topDown.fit();
    playerView.fit();
  }

  fit();
  addEventListener("resize", fit);
  play();

  return () => {
    stopFrames();
    clearTimeout(nextRound);
    removeEventListener("resize", fit);
  };
}

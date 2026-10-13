import { hasComponent } from "bitecs";
import { useEffect, useRef, useState } from "react";
import { AVERAGE_GRADE, BEST_GRADE, PITCH_LENGTH, TOUCH_REACH, WORST_GRADE } from "../../src/constants";
import { tackleWinChance } from "../../src/defender";
import { GOAL_CENTRE, isGoal } from "../../src/goal";
import type { Point } from "../../src/shooting";
import { addBall, addDefender, addGoalkeeper, addPlayer, createGame, setAttacking, type Game } from "../../src/world";
import { circleAroundAim, holdBallWhereItCrossed, percent } from "../attackingRound";
import { runEveryFrame } from "../frames";
import { createPlayerView } from "../playerView";
import { COLOURS, createTopDown } from "../topDown";

const ATTACKING_END = { fromX: 60, toX: PITCH_LENGTH };
const NEAREST_START = 20;
const FURTHEST_START = 35;
const WIDEST_START = 15;
const DEFENDER_NEAREST_AHEAD = 3;
const DEFENDER_FURTHEST_AHEAD = 14;
const DEFENDER_WIDEST_OFF_THE_LINE = 6;
const PAUSE_BETWEEN_ROUNDS = 1500;
const LONGEST_ROUND = 15;
const LONGEST_TRAIL = 600;

type Grades = { shooting: number; dribbling: number; tackling: number };
type Outcome = "Goal" | "Saved" | "Blocked" | "Tackled" | "Claimed at the attacker's feet" | "Wide or over" | "Fell short" | "Ran out of time";
type Tally = Partial<Record<Outcome | "Beat the defender", number>>;

const SLIDERS: { grade: keyof Grades; label: string }[] = [
  { grade: "shooting", label: "Attacker's shooting" },
  { grade: "dribbling", label: "Attacker's dribbling" },
  { grade: "tackling", label: "Defender's tackling" },
];

export function TakeOnView() {
  const topDownRef = useRef<HTMLCanvasElement>(null);
  const playerViewRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLParagraphElement>(null);
  const tallyRef = useRef<HTMLParagraphElement>(null);
  const grades = useRef<Grades>({ shooting: AVERAGE_GRADE, dribbling: AVERAGE_GRADE, tackling: AVERAGE_GRADE });
  const [shown, setShown] = useState(grades.current);

  useEffect(
    () => runTakeOns(topDownRef.current!, playerViewRef.current!, readoutRef.current!, tallyRef.current!, () => grades.current),
    [],
  );

  function changeGrade(grade: keyof Grades, value: number) {
    grades.current = { ...grades.current, [grade]: value };
    setShown(grades.current);
  }

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
        {SLIDERS.map(({ grade, label }) => (
          <label key={grade}>
            {label}
            <input
              type="range"
              min={WORST_GRADE}
              max={BEST_GRADE}
              value={shown[grade]}
              onChange={(e) => changeGrade(grade, Number(e.target.value))}
            />
            {shown[grade]}
          </label>
        ))}
        <span>Defender wins {percent(tackleWinChance(shown.tackling, shown.dribbling))} of tackles, from the next round</span>
        <p ref={readoutRef} />
        <p ref={tallyRef} />
      </div>
    </div>
  );
}

const between = (low: number, high: number) => low + Math.random() * (high - low);

function setUpRound(grades: Grades) {
  const world = createGame(Math.floor(Math.random() * 2 ** 31));
  const x = PITCH_LENGTH - between(NEAREST_START, FURTHEST_START);
  const y = GOAL_CENTRE + between(-WIDEST_START, WIDEST_START);
  const facing = Math.atan2(GOAL_CENTRE - y, PITCH_LENGTH - x);
  const behind = TOUCH_REACH * 0.5;
  const attacker = addPlayer(world, x - Math.cos(facing) * behind, y - Math.sin(facing) * behind, facing, grades.shooting, grades.dribbling);
  const ball = addBall(world, x, y);
  const ahead = between(DEFENDER_NEAREST_AHEAD, DEFENDER_FURTHEST_AHEAD);
  const offTheLine = between(-DEFENDER_WIDEST_OFF_THE_LINE, DEFENDER_WIDEST_OFF_THE_LINE);
  const defender = addDefender(
    world,
    x + Math.cos(facing) * ahead - Math.sin(facing) * offTheLine,
    y + Math.sin(facing) * ahead + Math.cos(facing) * offTheLine,
    facing + Math.PI,
    grades.tackling,
  );
  const keeper = addGoalkeeper(world, PITCH_LENGTH, GOAL_CENTRE);
  setAttacking(world, attacker);
  return { world, attacker, ball, defender, keeper, startedAt: performance.now() };
}

function outcomeOf(world: Game, ball: number, attacker: number, shotTaken: boolean, seconds: number): Outcome | null {
  const { GoalLineCrossing, Held, Blocked, Tackled, Velocity } = world.components;
  if (hasComponent(world, attacker, Tackled)) return "Tackled";
  if (hasComponent(world, ball, Blocked)) return "Blocked";
  if (hasComponent(world, ball, Held)) return shotTaken ? "Saved" : "Claimed at the attacker's feet";
  if (hasComponent(world, ball, GoalLineCrossing)) return isGoal(GoalLineCrossing.y[ball]!, GoalLineCrossing.z[ball]!) ? "Goal" : "Wide or over";
  if (shotTaken && Velocity.x[ball] === 0 && Velocity.y[ball] === 0) return "Fell short";
  if (seconds > LONGEST_ROUND) return "Ran out of time";
  return null;
}

function runTakeOns(
  topDownCanvas: HTMLCanvasElement,
  playerCanvas: HTMLCanvasElement,
  readout: HTMLElement,
  tallyOut: HTMLElement,
  currentGrades: () => Grades,
) {
  const topDown = createTopDown(topDownCanvas, ATTACKING_END);
  const playerView = createPlayerView(playerCanvas);
  const tally: Tally = {};
  const count = (what: keyof Tally) => (tally[what] = (tally[what] ?? 0) + 1);
  let round = 0;
  let stopFrames = () => {};
  let nextRound = 0;

  function play() {
    round++;
    const grades = currentGrades();
    const { world, attacker, ball, defender, keeper, startedAt } = setUpRound(grades);
    const { Position, Facing, Attacking, Struck, Target, Grounded } = world.components;
    const trail: Point[] = [];
    let shot: { from: Point; chance: number; aim: Point } | null = null;
    let outcome: Outcome | null = null;
    let aim: Point = [PITCH_LENGTH, GOAL_CENTRE, 1];
    let chance = 0;
    let furtherOn = 0;
    let beaten = 0;
    let wasGrounded = false;

    function describe(): string {
      const past = beaten > 0 ? `, past the defender${beaten > 1 ? ` ${beaten} times` : ""}` : "";
      if (outcome && shot) return `${outcome}, from a ${percent(shot.chance)} chance ${(PITCH_LENGTH - shot.from[0]).toFixed(0)} m out${past}`;
      if (outcome) return `${outcome}${past}`;
      if (shot) return `Shot! ${percent(shot.chance)} chance from ${(PITCH_LENGTH - shot.from[0]).toFixed(0)} m out${past}`;
      if (hasComponent(world, defender, Grounded)) return "Beat the defender!";
      if (Number.isNaN(Attacking.aimY[attacker]!)) return "On the ball…";
      return `${percent(chance)} if they shoot now, up to ${percent(furtherOn)} carrying on${past}`;
    }

    function noteTakeOns() {
      const grounded = hasComponent(world, defender, Grounded);
      if (grounded && !wasGrounded) {
        beaten++;
        count("Beat the defender");
      }
      wasGrounded = grounded;
    }

    function draw() {
      const seconds = (performance.now() - startedAt) / 1000;
      holdBallWhereItCrossed(world, ball);
      noteTakeOns();
      const ballAt: Point = [Position.x[ball]!, Position.y[ball]!, Position.z[ball]!];
      if (hasComponent(world, attacker, Attacking) && !Number.isNaN(Attacking.aimY[attacker]!)) {
        aim = [PITCH_LENGTH, Attacking.aimY[attacker]!, Attacking.aimZ[attacker]!];
        chance = Attacking.chance[attacker]!;
        furtherOn = Attacking.bestChanceFurtherOn[attacker]!;
      }
      if (!shot && hasComponent(world, ball, Struck)) shot = { from: ballAt, chance, aim };
      if (shot && trail.length < LONGEST_TRAIL) trail.push(ballAt);
      if (!outcome) {
        outcome = outcomeOf(world, ball, attacker, shot !== null, seconds);
        if (outcome) {
          count(outcome);
          nextRound = window.setTimeout(restart, PAUSE_BETWEEN_ROUNDS);
        }
      }

      const grounded = hasComponent(world, defender, Grounded);
      const defenderAt: [number, number] = [Position.x[defender]!, Position.y[defender]!];
      topDown.drawPitch();
      if (!shot && !outcome) topDown.drawLine(ballAt[0], ballAt[1], aim[0], aim[1], COLOURS.aim);
      if (hasComponent(world, keeper, Target)) {
        topDown.drawLine(Position.x[keeper]!, Position.y[keeper]!, world.components.Target.x[keeper]!, world.components.Target.y[keeper]!, COLOURS.keeper);
      }
      topDown.drawPlayer(Position.x[attacker]!, Position.y[attacker]!, Facing[attacker]!);
      topDown.drawPlayer(...defenderAt, Facing[defender]!, COLOURS.defender);
      if (grounded) topDown.drawCross(...defenderAt, COLOURS.defender);
      topDown.drawPlayer(Position.x[keeper]!, Position.y[keeper]!, Facing[keeper]!, COLOURS.keeper);
      topDown.drawBall(...ballAt);

      const behind = shot ? shot.from : ballAt;
      playerView.standBehind(behind[0], behind[1]);
      playerView.draw(
        ballAt,
        trail,
        shot ? shot.aim : aim,
        shot || outcome ? [] : circleAroundAim(grades.shooting, ballAt, aim),
        [Position.x[keeper]!, Position.y[keeper]!],
        [{ at: defenderAt, grounded }],
      );

      readout.textContent = `Round ${round}: ${describe()}`;
      tallyOut.textContent = Object.entries(tally)
        .map(([name, times]) => `${name} ${times}`)
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

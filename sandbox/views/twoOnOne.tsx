import { hasComponent } from "bitecs";
import { useEffect, useRef, useState } from "react";
import { AVERAGE_GRADE, BEST_GRADE, PITCH_LENGTH, PITCH_WIDTH, TOUCH_REACH, WORST_GRADE } from "../../src/constants";
import { tackleWinChance } from "../../src/defender";
import { GOAL_CENTRE, isGoal } from "../../src/goal";
import type { Point } from "../../src/shooting";
import { addBall, addDefender, addGoalkeeper, addPlayer, addTeam, createGame, DOWN_THE_PITCH, UP_THE_PITCH, joinTeam, setAttacking, setSupporting, type Game } from "../../src/world";
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
const TEAMMATE_NEAREST_ACROSS = 6;
const TEAMMATE_FURTHEST_ACROSS = 12;
const TEAMMATE_FURTHEST_BEHIND = 4;
const PAUSE_BETWEEN_ROUNDS = 1500;
const LONGEST_ROUND = 15;
const LONGEST_TRAIL = 600;

type Grades = { shooting: number; dribbling: number; tackling: number };
type Setup = { grades: Grades; withTeammate: boolean };
type Outcome =
  | "Goal"
  | "Saved"
  | "Blocked"
  | "Tackled"
  | "Intercepted"
  | "Claimed at the attacker's feet"
  | "Wide or over"
  | "Fell short"
  | "Ran out of time";
type Tally = Partial<Record<Outcome | "Beat the defender" | "Passes", number>>;

const SLIDERS: { grade: keyof Grades; label: string }[] = [
  { grade: "shooting", label: "Attacker's shooting" },
  { grade: "dribbling", label: "Attacker's dribbling" },
  { grade: "tackling", label: "Defender's tackling" },
];

export function TwoOnOneView() {
  const topDownRef = useRef<HTMLCanvasElement>(null);
  const playerViewRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLParagraphElement>(null);
  const tallyRef = useRef<HTMLParagraphElement>(null);
  const grades = useRef<Grades>({ shooting: AVERAGE_GRADE, dribbling: AVERAGE_GRADE, tackling: AVERAGE_GRADE });
  const [shown, setShown] = useState(grades.current);
  const withTeammate = useRef(true);
  const [teammateShown, setTeammateShown] = useState(true);

  useEffect(
    () =>
      runTakeOns(topDownRef.current!, playerViewRef.current!, readoutRef.current!, tallyRef.current!, () => ({
        grades: grades.current,
        withTeammate: withTeammate.current,
      })),
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
        <label>
          <input
            type="checkbox"
            checked={teammateShown}
            onChange={(e) => {
              withTeammate.current = e.target.checked;
              setTeammateShown(e.target.checked);
            }}
          />
          Teammate
        </label>
        <span>Defender wins {percent(tackleWinChance(shown.tackling, shown.dribbling))} of tackles. Changes apply from the next round</span>
        <p ref={readoutRef} />
        <p ref={tallyRef} />
      </div>
    </div>
  );
}

const between = (low: number, high: number) => low + Math.random() * (high - low);

function addTeammate(world: Game, team: number, x: number, y: number, facing: number, grades: Grades) {
  const side = Math.random() < 0.5 ? -1 : 1;
  const across = side * between(TEAMMATE_NEAREST_ACROSS, TEAMMATE_FURTHEST_ACROSS);
  const behind = between(0, TEAMMATE_FURTHEST_BEHIND);
  const teammate = addPlayer(
    world,
    x - Math.sin(facing) * across - Math.cos(facing) * behind,
    Math.max(1, Math.min(PITCH_WIDTH - 1, y + Math.cos(facing) * across - Math.sin(facing) * behind)),
    facing,
    grades.shooting,
    grades.dribbling,
  );
  joinTeam(world, teammate, team);
  setSupporting(world, teammate);
  return teammate;
}

function setUpRound({ grades, withTeammate }: Setup) {
  const world = createGame(Math.floor(Math.random() * 2 ** 31));
  const x = PITCH_LENGTH - between(NEAREST_START, FURTHEST_START);
  const y = GOAL_CENTRE + between(-WIDEST_START, WIDEST_START);
  const facing = Math.atan2(GOAL_CENTRE - y, PITCH_LENGTH - x);
  const behind = TOUCH_REACH * 0.5;
  const [attacking, defending] = [addTeam(world, UP_THE_PITCH), addTeam(world, DOWN_THE_PITCH)];
  const attacker = joinTeam(world, addPlayer(world, x - Math.cos(facing) * behind, y - Math.sin(facing) * behind, facing, grades.shooting, grades.dribbling), attacking);
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
  joinTeam(world, defender, defending);
  const keeper = joinTeam(world, addGoalkeeper(world, PITCH_LENGTH, GOAL_CENTRE), defending);
  setAttacking(world, attacker);
  const attackers = withTeammate ? [attacker, addTeammate(world, attacking, x, y, facing, grades)] : [attacker];
  return { world, attackers, ball, defender, keeper, grades, startedAt: performance.now() };
}

function outcomeOf(world: Game, ball: number, attackers: number[], shotTaken: boolean, seconds: number): Outcome | null {
  const { GoalLineCrossing, Held, Blocked, Tackled, Intercepted, Velocity } = world.components;
  if (attackers.some((attacker) => hasComponent(world, attacker, Tackled))) return "Tackled";
  if (hasComponent(world, ball, Intercepted)) return "Intercepted";
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
  currentSetup: () => Setup,
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
    const { world, attackers, ball, defender, keeper, grades, startedAt } = setUpRound(currentSetup());
    const { Position, Facing, Attacking, Struck, Target, Grounded, Passed } = world.components;
    const trail: Point[] = [];
    let shot: { from: Point; chance: number; aim: Point } | null = null;
    let outcome: Outcome | null = null;
    let aim: Point = [PITCH_LENGTH, GOAL_CENTRE, 1];
    let chance = 0;
    let furtherOn = 0;
    let passing = 0;
    let beaten = 0;
    let passes = 0;
    let wasGrounded = false;
    let wasPassed = false;
    let onTheBall = attackers[0]!;

    function describe(): string {
      const pastTheDefender = beaten > 0 ? `past the defender${beaten > 1 ? ` ${beaten} times` : ""}` : "";
      const passed = passes > 0 ? `${passes} pass${passes > 1 ? "es" : ""}` : "";
      const past = [pastTheDefender, passed].filter(Boolean).map((part) => `, ${part}`).join("");
      if (outcome && shot) return `${outcome}, from a ${percent(shot.chance)} chance ${(PITCH_LENGTH - shot.from[0]).toFixed(0)} m out${past}`;
      if (outcome) return `${outcome}${past}`;
      if (shot) return `Shot! ${percent(shot.chance)} chance from ${(PITCH_LENGTH - shot.from[0]).toFixed(0)} m out${past}`;
      if (hasComponent(world, ball, Passed)) return `Pass! Worth ${percent(passing)}${past}`;
      if (hasComponent(world, defender, Grounded)) return "Beat the defender!";
      if (Number.isNaN(Attacking.aimY[onTheBall]!)) return `On the ball…${past}`;
      const passOption = attackers.length > 1 ? `, ${percent(passing)} passing` : "";
      return `${percent(chance)} if they shoot now, up to ${percent(furtherOn)} carrying on${passOption}${past}`;
    }

    function noteTakeOns() {
      const grounded = hasComponent(world, defender, Grounded);
      if (grounded && !wasGrounded) {
        beaten++;
        count("Beat the defender");
      }
      wasGrounded = grounded;
      const passed = hasComponent(world, ball, Passed);
      if (passed && !wasPassed) {
        passes++;
        count("Passes");
      }
      wasPassed = passed;
    }

    function draw() {
      const seconds = (performance.now() - startedAt) / 1000;
      holdBallWhereItCrossed(world, ball);
      noteTakeOns();
      const ballAt: Point = [Position.x[ball]!, Position.y[ball]!, Position.z[ball]!];
      onTheBall = attackers.find((attacker) => hasComponent(world, attacker, Attacking)) ?? onTheBall;
      if (hasComponent(world, onTheBall, Attacking) && !Number.isNaN(Attacking.aimY[onTheBall]!)) {
        aim = [PITCH_LENGTH, Attacking.aimY[onTheBall]!, Attacking.aimZ[onTheBall]!];
        chance = Attacking.chance[onTheBall]!;
        furtherOn = Attacking.bestChanceFurtherOn[onTheBall]!;
        passing = Attacking.bestPass[onTheBall]!;
      }
      if (!shot && hasComponent(world, ball, Struck)) shot = { from: ballAt, chance, aim };
      if (shot && trail.length < LONGEST_TRAIL) trail.push(ballAt);
      if (!outcome) {
        outcome = outcomeOf(world, ball, attackers, shot !== null, seconds);
        if (outcome) {
          count(outcome);
          nextRound = window.setTimeout(restart, PAUSE_BETWEEN_ROUNDS);
        }
      }

      const grounded = hasComponent(world, defender, Grounded);
      const defenderAt: [number, number] = [Position.x[defender]!, Position.y[defender]!];
      topDown.drawPitch();
      if (!shot && !outcome && !hasComponent(world, ball, Passed)) topDown.drawLine(ballAt[0], ballAt[1], aim[0], aim[1], COLOURS.aim);
      if (hasComponent(world, ball, Passed)) topDown.drawLine(ballAt[0], ballAt[1], Passed.x[ball]!, Passed.y[ball]!, COLOURS.player);
      if (hasComponent(world, keeper, Target)) {
        topDown.drawLine(Position.x[keeper]!, Position.y[keeper]!, world.components.Target.x[keeper]!, world.components.Target.y[keeper]!, COLOURS.keeper);
      }
      for (const attacker of attackers) topDown.drawPlayer(Position.x[attacker]!, Position.y[attacker]!, Facing[attacker]!);
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
        attackers.filter((attacker) => attacker !== onTheBall).map((attacker) => [Position.x[attacker]!, Position.y[attacker]!]),
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

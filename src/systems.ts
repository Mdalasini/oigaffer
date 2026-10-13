import { addComponent, hasComponent, Not, query, removeComponent } from "bitecs";
import {
  ACCELERATION,
  ARRIVAL_DISTANCE,
  BRAKING,
  CROSSBAR_HEIGHT,
  DISTANCE_BEHIND_BALL,
  DRIBBLE_BRAKING,
  DRIBBLE_STOP_DISTANCE,
  GOAL_WIDTH,
  KEEPER_DIVE_SPEED,
  KEEPER_HIGHEST_REACH,
  KEEPER_REACH,
  KEEPER_REACTION_TIME,
  MAX_DRIBBLE_TOUCH_SPEED,
  MAX_TOUCH_SPEED_AWAY_FROM_PLAYER,
  PITCH_LENGTH,
  PITCH_WIDTH,
  SIDEWAYS_SPEED,
  STANDING_SPEED,
  TIME_STEP,
  TOP_SPEED,
  TOUCH_INTERVAL,
  TOUCH_REACH,
  TURN_RATE,
} from "./constants";
import { acrossThePath, closestPassThisStep, crossing, flying, GOAL_LINE, isOnTheGround, rolling, whereBallCrosses } from "./flight";
import { kick, missAim, spreadRadius, strikeSpeed, type Point } from "./shooting";
import { setTarget, strikeBall, type Game } from "./world";

const angleBetween = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

const facesAnyWay = (facing: number) => Number.isNaN(facing);

const stoppingSpeed = (distance: number, braking: number) => Math.sqrt(2 * braking * Math.max(0, distance));

function turnTowards(facing: number, heading: number, maxTurn: number): number {
  const turn = angleBetween(facing, heading);
  return Math.abs(turn) <= maxTurn ? heading : facing + Math.sign(turn) * maxTurn;
}

function topSpeedFacing(facing: number, heading: number): number {
  const ahead = Math.max(0, Math.cos(angleBetween(facing, heading)));
  return SIDEWAYS_SPEED + (TOP_SPEED - SIDEWAYS_SPEED) * ahead;
}

function arrive(world: Game, eid: number, dt: number): void {
  const { Position, Velocity, Target, Facing } = world.components;
  Position.x[eid] = Target.x[eid]!;
  Position.y[eid] = Target.y[eid]!;
  Velocity.x[eid] = Target.vx[eid]!;
  Velocity.y[eid] = Target.vy[eid]!;
  const arrivalFacing = Target.arrivalFacing[eid]!;
  if (facesAnyWay(arrivalFacing)) {
    removeComponent(world, eid, Target);
    return;
  }
  Facing[eid] = turnTowards(Facing[eid]!, arrivalFacing, TURN_RATE * dt);
  if (Facing[eid] === arrivalFacing) removeComponent(world, eid, Target);
}

function accelerateTowards(world: Game, eid: number, wantX: number, wantY: number, dt: number): void {
  const { Velocity } = world.components;
  const vx = Velocity.x[eid]!;
  const vy = Velocity.y[eid]!;
  const changeX = wantX - vx;
  const changeY = wantY - vy;
  const change = Math.hypot(changeX, changeY);
  const speedingUp = Math.hypot(wantX, wantY) > Math.hypot(vx, vy);
  const limit = (speedingUp ? ACCELERATION : BRAKING) * dt;
  const share = change > limit ? limit / change : 1;
  Velocity.x[eid] = vx + changeX * share;
  Velocity.y[eid] = vy + changeY * share;
}

export function runToTarget(world: Game, dt: number): void {
  const { Position, Velocity, Target, Facing } = world.components;
  for (const eid of query(world, [Position, Velocity, Target, Facing])) {
    const targetVx = Target.vx[eid]!;
    const targetVy = Target.vy[eid]!;
    const dx = Target.x[eid]! - Position.x[eid]!;
    const dy = Target.y[eid]! - Position.y[eid]!;
    const distance = Math.hypot(dx, dy);
    const closingSpeed = Math.hypot(Velocity.x[eid]! - targetVx, Velocity.y[eid]! - targetVy);

    if (distance < ARRIVAL_DISTANCE && closingSpeed < BRAKING * dt) {
      arrive(world, eid, dt);
      continue;
    }

    const distanceAfterStep = distance - closingSpeed * dt;
    const approachSpeed = Math.min(TOP_SPEED, stoppingSpeed(distanceAfterStep, BRAKING));
    const towardsX = distance > 0 ? dx / distance : 0;
    const towardsY = distance > 0 ? dy / distance : 0;
    let wantX = targetVx + towardsX * approachSpeed;
    let wantY = targetVy + towardsY * approachSpeed;
    const wantedSpeed = Math.hypot(wantX, wantY);
    const heading = Math.atan2(wantY, wantX);

    const arrivalFacing = Target.arrivalFacing[eid]!;
    if (wantedSpeed > STANDING_SPEED) Facing[eid] = turnTowards(Facing[eid]!, heading, TURN_RATE * dt);
    else if (!facesAnyWay(arrivalFacing)) Facing[eid] = turnTowards(Facing[eid]!, arrivalFacing, TURN_RATE * dt);

    const allowedSpeed = topSpeedFacing(Facing[eid]!, heading);
    if (wantedSpeed > allowedSpeed) {
      wantX *= allowedSpeed / wantedSpeed;
      wantY *= allowedSpeed / wantedSpeed;
    }
    accelerateTowards(world, eid, wantX, wantY, dt);
  }
}

function dribbleTouchSpeed(distanceLeft: number): number {
  return Math.min(
    MAX_DRIBBLE_TOUCH_SPEED,
    stoppingSpeed(distanceLeft, DRIBBLE_BRAKING),
    distanceLeft / TOUCH_INTERVAL,
  );
}

function touchAwayFromPlayer(world: Game, eid: number, ball: number, wantX: number, wantY: number): void {
  const { Velocity } = world.components;
  const awayX = wantX - Velocity.x[eid]!;
  const awayY = wantY - Velocity.y[eid]!;
  const away = Math.hypot(awayX, awayY);
  const share = away > MAX_TOUCH_SPEED_AWAY_FROM_PLAYER ? MAX_TOUCH_SPEED_AWAY_FROM_PLAYER / away : 1;
  Velocity.x[ball] = Velocity.x[eid]! + awayX * share;
  Velocity.y[ball] = Velocity.y[eid]! + awayY * share;
}

function directionFromBall(world: Game, ball: number, toX: number, toY: number) {
  const { Position } = world.components;
  const dx = toX - Position.x[ball]!;
  const dy = toY - Position.y[ball]!;
  const distance = Math.hypot(dx, dy);
  return { distance, onwardX: distance > 0 ? dx / distance : 0, onwardY: distance > 0 ? dy / distance : 0 };
}

function whereBallIs(world: Game, eid: number, ball: number, onwardX: number, onwardY: number) {
  const { Position, Facing } = world.components;
  const toBallX = Position.x[ball]! - Position.x[eid]!;
  const toBallY = Position.y[ball]! - Position.y[eid]!;
  return {
    withinReach: Math.hypot(toBallX, toBallY) <= TOUCH_REACH,
    inFront: Math.abs(angleBetween(Facing[eid]!, Math.atan2(toBallY, toBallX))) <= Math.PI / 2,
    onTheWay: toBallX * onwardX + toBallY * onwardY >= 0,
  };
}

function getBehindBall(world: Game, eid: number, ball: number, onwardX: number, onwardY: number): void {
  const { Position, Velocity } = world.components;
  setTarget(
    world,
    eid,
    Position.x[ball]! - onwardX * DISTANCE_BEHIND_BALL,
    Position.y[ball]! - onwardY * DISTANCE_BEHIND_BALL,
    Velocity.x[ball]!,
    Velocity.y[ball]!,
    Math.atan2(onwardY, onwardX),
  );
}

export function dribble(world: Game, dt: number): void {
  const { Position, Velocity, Facing, Dribble, Ball } = world.components;
  const ball = query(world, [Ball])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Velocity, Facing, Dribble])) {
    const { distance: distanceLeft, onwardX, onwardY } = directionFromBall(world, ball, Dribble.x[eid]!, Dribble.y[eid]!);
    Dribble.nextTouchIn[eid] = Math.max(0, Dribble.nextTouchIn[eid]! - dt);

    const arrived = distanceLeft < DRIBBLE_STOP_DISTANCE;
    const ready = Dribble.nextTouchIn[eid] === 0;
    const ballIs = whereBallIs(world, eid, ball, onwardX, onwardY);

    if (ballIs.withinReach && ready && ballIs.inFront && (ballIs.onTheWay || arrived)) {
      Dribble.nextTouchIn[eid] = TOUCH_INTERVAL;
      if (arrived) {
        Velocity.x[ball] = 0;
        Velocity.y[ball] = 0;
        removeComponent(world, eid, Dribble);
      } else {
        const touchSpeed = dribbleTouchSpeed(distanceLeft);
        touchAwayFromPlayer(world, eid, ball, onwardX * touchSpeed, onwardY * touchSpeed);
      }
    }

    getBehindBall(world, eid, ball, onwardX, onwardY);
  }
}

function strike(world: Game, ball: number, shooter: number): void {
  const { Position, Shot, Shooting } = world.components;
  const from: Point = [Position.x[ball]!, Position.y[ball]!, Position.z[ball]!];
  const aim: Point = [Shot.x[shooter]!, Shot.y[shooter]!, Shot.z[shooter]!];
  const grade = Shooting[shooter]!;
  const radius = spreadRadius(grade, from, aim);
  strikeBall(world, ball, kick(from, missAim(from, aim, radius, world.random), strikeSpeed(grade)));
}

export function shoot(world: Game): void {
  const { Position, Velocity, Facing, Shooting, Shot, Ball } = world.components;
  const ball = query(world, [Ball])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Velocity, Facing, Shooting, Shot])) {
    const { onwardX, onwardY } = directionFromBall(world, ball, Shot.x[eid]!, Shot.y[eid]!);
    const ballIs = whereBallIs(world, eid, ball, onwardX, onwardY);
    if (ballIs.withinReach && ballIs.inFront && ballIs.onTheWay) {
      strike(world, ball, eid);
      removeComponent(world, eid, Shot);
      continue;
    }
    getBehindBall(world, eid, ball, onwardX, onwardY);
  }
}

const onTheGround = (world: Game, eid: number) =>
  isOnTheGround(world.components.Position.z[eid]!, world.components.Velocity.z[eid]!);

export function roll(world: Game, dt: number): void {
  const { Velocity, Ball, Held } = world.components;
  for (const eid of query(world, [Ball, Velocity, Not(Held)])) {
    if (!onTheGround(world, eid)) continue;
    [Velocity.x[eid], Velocity.y[eid]] = rolling(Velocity.x[eid]!, Velocity.y[eid]!, dt);
  }
}

export function fly(world: Game, dt: number): void {
  const { Position, Velocity, Ball, Held } = world.components;
  for (const eid of query(world, [Ball, Position, Velocity, Not(Held)])) {
    if (onTheGround(world, eid)) continue;
    [Position.z[eid], Velocity.z[eid]] = flying(Position.z[eid]!, Velocity.z[eid]!, dt);
  }
}

export function move(world: Game, dt: number): void {
  const { Position, Velocity } = world.components;
  for (const eid of query(world, [Position, Velocity])) {
    Position.x[eid] = Position.x[eid]! + Velocity.x[eid]! * dt;
    Position.y[eid] = Position.y[eid]! + Velocity.y[eid]! * dt;
  }
}

export function isGoal(y: number, z: number): boolean {
  return Math.abs(y - PITCH_WIDTH / 2) < GOAL_WIDTH / 2 && z < CROSSBAR_HEIGHT;
}

const pointOf = (part: { x: number[]; y: number[]; z: number[] }, eid: number): Point => [part.x[eid]!, part.y[eid]!, part.z[eid]!];

export function watchGoalLine(world: Game): void {
  const { Position, Velocity, GoalLineCrossing, Ball } = world.components;
  for (const eid of query(world, [Ball, Position, Velocity])) {
    if (hasComponent(world, eid, GoalLineCrossing) || Position.x[eid]! < PITCH_LENGTH || Velocity.x[eid]! <= 0) continue;
    addComponent(world, eid, GoalLineCrossing);
    const [, y, z] = crossing(GOAL_LINE, pointOf(Position, eid), pointOf(Velocity, eid));
    GoalLineCrossing.y[eid] = y;
    GoalLineCrossing.z[eid] = z;
  }
}

function diveAcross(world: Game, keeper: number, ball: number, dt: number): void {
  const { Position, Velocity } = world.components;
  const path = acrossThePath(Position.x[keeper]!, Position.y[keeper]!, pointOf(Velocity, ball));
  const passes = path && whereBallCrosses(path, pointOf(Position, ball), pointOf(Velocity, ball), dt);
  if (!passes) {
    Velocity.x[keeper] = 0;
    Velocity.y[keeper] = 0;
    return;
  }
  const gapX = passes[0] - Position.x[keeper]!;
  const gapY = passes[1] - Position.y[keeper]!;
  const gap = Math.hypot(gapX, gapY);
  const speed = gap > 0 ? Math.min(KEEPER_DIVE_SPEED, gap / dt) / gap : 0;
  Velocity.x[keeper] = gapX * speed;
  Velocity.y[keeper] = gapY * speed;
}

export function goalkeep(world: Game, dt: number): void {
  const { Position, Velocity, Goalkeeper, Struck, Ball } = world.components;
  const ball = query(world, [Ball])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Velocity, Goalkeeper])) {
    if (!hasComponent(world, ball, Struck)) {
      Goalkeeper.watchingShotFor[eid] = 0;
      Velocity.x[eid] = 0;
      Velocity.y[eid] = 0;
      continue;
    }
    Goalkeeper.watchingShotFor[eid] = Goalkeeper.watchingShotFor[eid]! + dt;
    if (Goalkeeper.watchingShotFor[eid]! >= KEEPER_REACTION_TIME) diveAcross(world, eid, ball, dt);
  }
}

const withinKeeperReach = (keeperX: number, keeperY: number, [x, y, z]: Point) =>
  Math.hypot(x - keeperX, y - keeperY) <= KEEPER_REACH && z <= KEEPER_HIGHEST_REACH;

export function save(world: Game, dt: number): void {
  const { Position, Velocity, Goalkeeper, Held, Struck, Ball } = world.components;
  for (const ball of query(world, [Ball, Position, Velocity, Not(Held)])) {
    for (const keeper of query(world, [Position, Goalkeeper])) {
      const keeperX = Position.x[keeper]!;
      const keeperY = Position.y[keeper]!;
      const nearest = closestPassThisStep(keeperX, keeperY, pointOf(Position, ball), pointOf(Velocity, ball), dt);
      if (!withinKeeperReach(keeperX, keeperY, nearest)) continue;
      [Position.x[ball], Position.y[ball], Position.z[ball]] = nearest;
      [Velocity.x[ball], Velocity.y[ball], Velocity.z[ball]] = [0, 0, 0];
      removeComponent(world, ball, Struck);
      addComponent(world, ball, Held);
      break;
    }
  }
}

export function step(world: Game, dt = TIME_STEP): void {
  dribble(world, dt);
  shoot(world);
  goalkeep(world, dt);
  runToTarget(world, dt);
  roll(world, dt);
  fly(world, dt);
  move(world, dt);
  save(world, dt);
  watchGoalLine(world);
}

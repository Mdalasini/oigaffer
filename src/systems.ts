import { addComponent, hasComponent, Not, query, removeComponent } from "bitecs";
import {
  ACCELERATION,
  BALL_ROLLING_DECELERATION,
  ARRIVAL_DISTANCE,
  BRAKING,
  CLEAR_GAIN_TO_PASS,
  DISTANCE_BEHIND_BALL,
  DRIBBLE_BRAKING,
  DRIBBLE_STOP_DISTANCE,
  GOAL_SIDE_DISTANCE,
  KEEPER_HIGHEST_REACH,
  KEEPER_REACH,
  MAX_DRIBBLE_TOUCH_SPEED,
  MAX_TOUCH_SPEED_AWAY_FROM_PLAYER,
  PASSING_GAP,
  PITCH_LENGTH,
  PITCH_WIDTH,
  SHARPEST_TAKE_ON,
  SIDEWAYS_SPEED,
  STANDING_SPEED,
  SUPPORT_FURTHEST_AHEAD,
  SUPPORT_FURTHEST_BEHIND,
  SUPPORT_RETHINK_INTERVAL,
  SUPPORT_SPACING,
  SUPPORT_SWITCHING_GAIN,
  SUPPORT_WIDEST,
  TACKLE_CLEARANCE_SPEED,
  TACKLE_REACH,
  TACKLE_RECOVERY_TIME,
  TIME_STEP,
  TOP_SPEED,
  TOUCH_INTERVAL,
  TOUCH_REACH,
  TURN_RATE,
} from "./constants";
import { ballFlight, closestPassThisStep, crossing, flying, GOAL_LINE, isOnTheGround, rolling, straightFlight, type StraightFlight } from "./flight";
import { bestChanceAroundOnceKeeperIsSet, bestShot, shotOptions, whereToStand } from "./chance";
import { distanceRunIn, isWithinBlockingReach, tackleWinChance, timeToRun, type Defender } from "./defender";
import { GOAL_CENTRE } from "./goal";
import { bestInterception, hasReacted, isWithinReach, type Mover } from "./interception";
import { INTERCEPTOR, interceptionOf, leadPass, passFlight, untilCollected } from "./passing";
import { KEEPER, type Keeper } from "./keeper";
import { kick, missAim, spreadRadius, strikeSpeed, type Point } from "./shooting";
import { setAttacking, setDribble, setPassing, setShot, setSupporting, setTarget, strikeBall, type Game } from "./world";

const angleBetween = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

const facesAnyWay = (facing: number) => Number.isNaN(facing);

const pointOf = (part: { x: number[]; y: number[]; z: number[] }, eid: number): Point => [part.x[eid]!, part.y[eid]!, part.z[eid]!];

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

function directionTo(from: Point, toX: number, toY: number) {
  const dx = toX - from[0];
  const dy = toY - from[1];
  const distance = Math.hypot(dx, dy);
  return { distance, onwardX: distance > 0 ? dx / distance : 0, onwardY: distance > 0 ? dy / distance : 0 };
}

const directionFromBall = (world: Game, ball: number, toX: number, toY: number) =>
  directionTo(pointOf(world.components.Position, ball), toX, toY);

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

function nearestDribbler(world: Game, ball: number): number | undefined {
  const { Position, Dribbling, Tackled } = world.components;
  let nearest: number | undefined;
  let nearestDistance = Infinity;
  for (const eid of query(world, [Position, Dribbling, Not(Tackled)])) {
    const distance = Math.hypot(Position.x[eid]! - Position.x[ball]!, Position.y[eid]! - Position.y[ball]!);
    if (distance < nearestDistance) [nearest, nearestDistance] = [eid, distance];
  }
  return nearest;
}

function loseTheBall(world: Game, attacker: number, ball: number): void {
  const { Position, Velocity, Attacking, Dribble, Shot, Tackled } = world.components;
  const { onwardX, onwardY } = directionTo([PITCH_LENGTH, GOAL_CENTRE, 0], Position.x[ball]!, Position.y[ball]!);
  Velocity.x[ball] = onwardX * TACKLE_CLEARANCE_SPEED;
  Velocity.y[ball] = onwardY * TACKLE_CLEARANCE_SPEED;
  removeComponent(world, attacker, Attacking);
  removeComponent(world, attacker, Dribble);
  removeComponent(world, attacker, Shot);
  removeComponent(world, attacker, world.components.Passing);
  addComponent(world, attacker, Tackled);
  setTarget(world, attacker, Position.x[attacker]!, Position.y[attacker]!);
}

function tackle(world: Game, defender: number, attacker: number, ball: number): void {
  const { Tackling, Dribbling, Grounded } = world.components;
  if (world.random() < tackleWinChance(Tackling[defender]!, Dribbling[attacker]!)) {
    loseTheBall(world, attacker, ball);
    standStill(world, defender);
    return;
  }
  standStill(world, defender);
  addComponent(world, defender, Grounded);
  Grounded.recoversIn[defender] = TACKLE_RECOVERY_TIME;
}

function closeDown(world: Game, defender: number, ball: number): void {
  const { Position, Velocity } = world.components;
  const from = pointOf(Position, ball);
  const { onwardX, onwardY } = directionTo(from, PITCH_LENGTH, GOAL_CENTRE);
  const spotX = from[0] + onwardX * GOAL_SIDE_DISTANCE;
  const spotY = from[1] + onwardY * GOAL_SIDE_DISTANCE;
  setTarget(world, defender, spotX, spotY, Velocity.x[ball]!, Velocity.y[ball]!, Math.atan2(from[1] - spotY, from[0] - spotX));
}

const isInPlay = (world: Game, ball: number) =>
  [world.components.Struck, world.components.Held, world.components.Blocked, world.components.Passed, world.components.Intercepted].every(
    (part) => !hasComponent(world, ball, part),
  );

function remainingPass(world: Game, ball: number, dt: number): StraightFlight | null {
  const { Position, Velocity, Passed } = world.components;
  const from = pointOf(Position, ball);
  const flight = straightFlight(from, pointOf(Velocity, ball), dt);
  return flight && untilCollected(flight, Math.hypot(Passed.x[ball]! - from[0], Passed.y[ball]! - from[1]));
}

function watchPass(world: Game, defender: number, ball: number, dt: number): void {
  const { WatchingPassFor, Grounded } = world.components;
  if (!hasComponent(world, defender, Grounded) && hasReacted(INTERCEPTOR, WatchingPassFor[defender]!, dt)) {
    raceToBall(world, defender, remainingPass(world, ball, dt), INTERCEPTOR, dt);
  }
  WatchingPassFor[defender] = WatchingPassFor[defender]! + dt;
}

export function defend(world: Game, dt: number): void {
  const { Position, Tackling, Grounded, Passed, Ball } = world.components;
  const ball = query(world, [Ball])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Tackling])) {
    if (hasComponent(world, ball, Passed)) {
      standStill(world, eid);
      watchPass(world, eid, ball, dt);
    }
    if (hasComponent(world, eid, Grounded)) {
      standStill(world, eid);
      Grounded.recoversIn[eid] = Grounded.recoversIn[eid]! - dt;
      if (Grounded.recoversIn[eid]! <= 0) removeComponent(world, eid, Grounded);
      continue;
    }
    if (hasComponent(world, ball, Passed)) continue;
    const attacker = nearestDribbler(world, ball);
    if (attacker === undefined || !isInPlay(world, ball)) {
      standStill(world, eid);
      continue;
    }
    const toBall = Math.hypot(Position.x[ball]! - Position.x[eid]!, Position.y[ball]! - Position.y[eid]!);
    if (toBall <= TACKLE_REACH) tackle(world, eid, attacker, ball);
    else closeDown(world, eid, ball);
  }
}

export function block(world: Game, dt: number): void {
  const { Position, Velocity, Tackling, Struck, Blocked, Ball } = world.components;
  for (const ball of query(world, [Ball, Position, Velocity, Struck])) {
    for (const defender of query(world, [Position, Tackling])) {
      const at: Defender = [Position.x[defender]!, Position.y[defender]!];
      const nearest = closestPassThisStep(at[0], at[1], pointOf(Position, ball), pointOf(Velocity, ball), dt);
      if (!isWithinBlockingReach(at, nearest)) continue;
      [Position.x[ball], Position.y[ball], Position.z[ball]] = nearest;
      [Velocity.x[ball], Velocity.y[ball], Velocity.z[ball]] = [0, 0, 0];
      removeComponent(world, ball, Struck);
      addComponent(world, ball, Blocked);
      break;
    }
  }
}

function playPass(world: Game, passer: number, receiver: number, ball: number): boolean {
  const { Position, Velocity, Attacking, Passing, Passed, Receiving, Supporting, WatchingPassFor } = world.components;
  const pass = leadPass(pointOf(Position, ball), [Position.x[receiver]!, Position.y[receiver]!], [Velocity.x[receiver]!, Velocity.y[receiver]!]);
  removeComponent(world, passer, Passing);
  if (!pass) return false;
  [Velocity.x[ball], Velocity.y[ball], Velocity.z[ball]] = pass.velocity;
  addComponent(world, ball, Passed);
  [Passed.x[ball], Passed.y[ball]] = [pass.to[0], pass.to[1]];
  for (const defender of query(world, [WatchingPassFor])) WatchingPassFor[defender] = 0;
  removeComponent(world, passer, Attacking);
  setSupporting(world, passer);
  removeComponent(world, receiver, Supporting);
  addComponent(world, receiver, Receiving);
  return true;
}

export function pass(world: Game): void {
  const { Position, Velocity, Facing, Passing, Ball } = world.components;
  const ball = query(world, [Ball])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Velocity, Facing, Passing])) {
    const receiver = Passing.to[eid]!;
    const { onwardX, onwardY } = directionFromBall(world, ball, Position.x[receiver]!, Position.y[receiver]!);
    const ballIs = whereBallIs(world, eid, ball, onwardX, onwardY);
    if (ballIs.withinReach && ballIs.inFront && ballIs.onTheWay) {
      playPass(world, eid, receiver, ball);
      continue;
    }
    getBehindBall(world, eid, ball, onwardX, onwardY);
  }
}

const isOnside = (world: Game, eid: number, ball: number) =>
  world.components.Position.x[eid]! <= offsideLine(world.components.Position.x[ball]!, opponentsX(opponents(world), keeperPosition(world)));

type Holder = { at: [x: number, y: number]; moving: [vx: number, vy: number] };

function whoWillHaveTheBall(world: Game, ball: number): Holder {
  const { Position, Velocity, Attacking, Receiving } = world.components;
  const holder = query(world, [Position, Velocity, Attacking])[0] ?? query(world, [Position, Velocity, Receiving])[0] ?? ball;
  return { at: [Position.x[holder]!, Position.y[holder]!], moving: [Velocity.x[holder]!, Velocity.y[holder]!] };
}

const offsetsAlong = (from: number, to: number) => Array.from({ length: Math.floor((to - from) / SUPPORT_SPACING) + 1 }, (_, i) => from + i * SUPPORT_SPACING);

const SUPPORT_SPOTS: [ahead: number, across: number][] = offsetsAlong(-SUPPORT_FURTHEST_BEHIND, SUPPORT_FURTHEST_AHEAD).flatMap((ahead) =>
  offsetsAlong(SUPPORT_SPACING, SUPPORT_WIDEST).flatMap((across): [number, number][] => [
    [ahead, across],
    [ahead, -across],
  ]),
);

function supportWorth(
  [ahead, across]: [number, number],
  supporter: Receiver,
  holder: Holder,
  passingMoment: Moment,
  keeper: Keeper | null,
  defenders: Opponent[],
  dt: number,
): number {
  const { spot, time } = passingMoment;
  const defendersThen = defenders.map((defender) => closingIn(defender, spot, time));
  const line = offsideLine(spot[0], opponentsX(defendersThen, keeper));
  const [x, y] = onThePitch([spot[0] + ahead, spot[1] + across]);
  return passValue(spot, { ...supporter, at: [Math.min(x, line), y], moving: holder.moving }, keeper, defendersThen, dt);
}

function bestSupportSpot(supporter: Receiver, holder: Holder, planned: [number, number], keeper: Keeper | null, defenders: Opponent[], dt: number) {
  const passingMoment = lastFreeMoment([...holder.at, 0], speedTowards(holder.moving, holder.at, GOAL), defenders);
  const asNow: [number, number] = [supporter.at[0] - holder.at[0], supporter.at[1] - holder.at[1]];
  const kept = planned.some(Number.isNaN) ? asNow : planned;
  const worthOf = (spot: [number, number]) => supportWorth(spot, supporter, holder, passingMoment, keeper, defenders, dt);
  let best = { spot: kept, worth: worthOf(kept) + SUPPORT_SWITCHING_GAIN };
  for (const spot of SUPPORT_SPOTS) {
    const worth = worthOf(spot);
    if (worth > best.worth) best = { spot, worth };
  }
  return best.spot;
}

export function support(world: Game, dt: number): void {
  const { Position, Supporting, Receiving, Tackled, Ball } = world.components;
  const ball = query(world, [Ball])[0];
  if (ball === undefined) return;
  const holder = whoWillHaveTheBall(world, ball);
  const keeper = keeperPosition(world);
  const defenders = opponents(world);
  const line = offsideLine(holder.at[0], opponentsX(defenders, keeper));
  for (const eid of query(world, [Position, Supporting, Not(Receiving), Not(Tackled)])) {
    Supporting.rethinkIn[eid] = Supporting.rethinkIn[eid]! - dt;
    if (Supporting.rethinkIn[eid]! <= 0) {
      const current: [number, number] = [Supporting.aheadOfBall[eid]!, Supporting.acrossFromBall[eid]!];
      [Supporting.aheadOfBall[eid], Supporting.acrossFromBall[eid]] = bestSupportSpot(receiverOf(world, eid), holder, current, keeper, defenders, dt);
      Supporting.rethinkIn[eid] = SUPPORT_RETHINK_INTERVAL;
    }
    const [x, y] = onThePitch([holder.at[0] + Supporting.aheadOfBall[eid]!, holder.at[1] + Supporting.acrossFromBall[eid]!]);
    setTarget(world, eid, Math.min(x, line), y, ...holder.moving);
  }
}

function meetThePass(world: Game, receiver: number, ball: number, dt: number): void {
  const { Position, Velocity, Passed } = world.components;
  const [x, y] = [Position.x[receiver]!, Position.y[receiver]!];
  const [vx, vy] = [Velocity.x[receiver]!, Velocity.y[receiver]!];
  const from = pointOf(Position, ball);
  const toThePassPoint = Math.hypot(Passed.x[ball]! - from[0], Passed.y[ball]! - from[1]);
  let time = 0;
  let meeting: Point = from;
  for (const [at] of ballFlight(from, pointOf(Velocity, ball), dt)) {
    time += dt;
    meeting = at;
    if (Math.hypot(at[0] - from[0], at[1] - from[1]) < toThePassPoint) continue;
    const offCourse = Math.hypot(at[0] - (x + vx * time), at[1] - (y + vy * time));
    if (offCourse - TOUCH_REACH <= (ACCELERATION * time * time) / 2) break;
  }
  const { Target, Facing } = world.components;
  removeComponent(world, receiver, Target);
  const wantX = (meeting[0] - x) / time;
  const wantY = (meeting[1] - y) / time;
  const wanted = Math.hypot(wantX, wantY);
  const share = wanted > TOP_SPEED ? TOP_SPEED / wanted : 1;
  accelerateTowards(world, receiver, wantX * share, wantY * share, dt);
  const heading = wanted > STANDING_SPEED ? Math.atan2(wantY, wantX) : Math.atan2(from[1] - y, from[0] - x);
  Facing[receiver] = turnTowards(Facing[receiver]!, heading, TURN_RATE * dt);
}

export function meetPass(world: Game, dt: number): void {
  const { Position, Receiving, Passed, Ball } = world.components;
  const ball = query(world, [Ball, Passed])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Receiving])) meetThePass(world, eid, ball, dt);
}

export function intercept(world: Game, dt: number): void {
  const { Position, Velocity, Tackling, Passed, Intercepted, Receiving, Ball } = world.components;
  for (const ball of query(world, [Ball, Position, Velocity, Passed])) {
    for (const defender of query(world, [Position, Tackling])) {
      const at: [number, number] = [Position.x[defender]!, Position.y[defender]!];
      const nearest = closestPassThisStep(at[0], at[1], pointOf(Position, ball), pointOf(Velocity, ball), dt);
      if (!isWithinReach(INTERCEPTOR, at, nearest)) continue;
      [Position.x[ball], Position.y[ball], Position.z[ball]] = nearest;
      const { onwardX, onwardY } = directionTo([PITCH_LENGTH, GOAL_CENTRE, 0], nearest[0], nearest[1]);
      [Velocity.x[ball], Velocity.y[ball], Velocity.z[ball]] = [onwardX * TACKLE_CLEARANCE_SPEED, onwardY * TACKLE_CLEARANCE_SPEED, 0];
      removeComponent(world, ball, Passed);
      addComponent(world, ball, Intercepted);
      for (const receiver of query(world, [Position, Receiving])) {
        removeComponent(world, receiver, Receiving);
        setTarget(world, receiver, Position.x[receiver]!, Position.y[receiver]!);
      }
      break;
    }
  }
}

export function receive(world: Game): void {
  const { Position, Velocity, Receiving, Passed, Ball } = world.components;
  const ball = query(world, [Ball, Passed])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Receiving])) {
    if (Math.hypot(Position.x[ball]! - Position.x[eid]!, Position.y[ball]! - Position.y[eid]!) > TOUCH_REACH) continue;
    [Velocity.x[ball], Velocity.y[ball], Velocity.z[ball]] = [Velocity.x[eid]!, Velocity.y[eid]!, 0];
    removeComponent(world, ball, Passed);
    removeComponent(world, eid, Receiving);
    setAttacking(world, eid);
    break;
  }
}

function keeperPosition(world: Game): Keeper | null {
  const { Position, Goalkeeper } = world.components;
  const keeper = query(world, [Position, Goalkeeper])[0];
  return keeper === undefined ? null : [Position.x[keeper]!, Position.y[keeper]!];
}

function isOnTheBall(world: Game, eid: number, ball: number, dt: number): boolean {
  const { Position, Dribble } = world.components;
  const ready = !hasComponent(world, eid, Dribble) || Dribble.nextTouchIn[eid]! <= dt;
  return ready && Math.hypot(Position.x[ball]! - Position.x[eid]!, Position.y[ball]! - Position.y[eid]!) <= TOUCH_REACH;
}

type Opponent = { at: Defender; moving: [vx: number, vy: number]; tackling: number; recoversIn: number };

function opponents(world: Game): Opponent[] {
  const { Position, Velocity, Tackling, Grounded } = world.components;
  return Array.from(query(world, [Position, Tackling]), (eid): Opponent => ({
    at: [Position.x[eid]!, Position.y[eid]!],
    moving: [Velocity.x[eid]!, Velocity.y[eid]!],
    tackling: Tackling[eid]!,
    recoversIn: hasComponent(world, eid, Grounded) ? Grounded.recoversIn[eid]! : 0,
  }));
}

const GOAL: Point = [PITCH_LENGTH, GOAL_CENTRE, 0];

const speedTowards = ([vx, vy]: [number, number], from: [number, number], to: Point) => {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return distance > 0 ? (vx * (to[0] - from[0]) + vy * (to[1] - from[1])) / distance : 0;
};

function canGetThere({ at, moving, recoversIn }: Opponent, spot: Point, timeThere: number): boolean {
  const toReach = Math.max(0, Math.hypot(spot[0] - at[0], spot[1] - at[1]) - TACKLE_REACH);
  return recoversIn + timeToRun(toReach, TOP_SPEED, recoversIn > 0 ? 0 : speedTowards(moving, at, spot)) <= timeThere;
}

const chanceOfBeating = (defenders: Opponent[], runner: Runner) =>
  defenders.reduce((chance, { tackling }) => chance * (1 - tackleWinChance(tackling, runner.dribbling)), 1);

type Runner = { shooting: number; dribbling: number; speed: number };

function closingIn(defender: Opponent, spot: Point, time: number): Opponent {
  const { at, moving, recoversIn } = defender;
  const { distance, onwardX, onwardY } = directionTo([...at, 0], spot[0], spot[1]);
  const running = Math.max(0, time - recoversIn);
  const covered = Math.min(Math.max(0, distance - TACKLE_REACH), distanceRunIn(running, TOP_SPEED, recoversIn > 0 ? 0 : speedTowards(moving, at, spot)));
  return { ...defender, at: [at[0] + onwardX * covered, at[1] + onwardY * covered], moving: [0, 0], recoversIn: 0 };
}

const onThePitch = ([x, y]: [number, number]): [x: number, y: number] => [Math.max(0, Math.min(PITCH_LENGTH, x)), Math.max(0, Math.min(PITCH_WIDTH, y))];

function offsideLine(ballX: number, opponentsX: number[]): number {
  const secondLast = [...opponentsX].sort((a, b) => b - a)[1] ?? PITCH_LENGTH;
  return Math.max(ballX, secondLast);
}

const opponentsX = (defenders: Opponent[], keeper: Keeper | null) => [...defenders.map(({ at }) => at[0]), ...(keeper ? [keeper[0]] : [])];

type Teammate = Receiver & { planned: [ahead: number, across: number] };

function whereTheyWillBe({ planned, ...teammate }: Teammate, ballThen: Point, time: number, line: number): Receiver {
  const { at, moving } = teammate;
  const heading: Point = planned.some(Number.isNaN)
    ? [at[0] + moving[0] * time, at[1] + moving[1] * time, 0]
    : [ballThen[0] + planned[0], ballThen[1] + planned[1], 0];
  const { distance, onwardX, onwardY } = directionTo([...at, 0], heading[0], heading[1]);
  const covered = Math.min(distance, distanceRunIn(time, TOP_SPEED, speedTowards(moving, at, heading)));
  const [x, y] = onThePitch([at[0] + onwardX * covered, at[1] + onwardY * covered]);
  return { ...teammate, at: [Math.min(x, line), y] };
}

function passingAt(spot: Point, time: number, teammates: Teammate[], defenders: Opponent[], keeper: Keeper | null, dt: number): number {
  const defendersThen = defenders.map((defender) => closingIn(defender, spot, time));
  const line = offsideLine(spot[0], opponentsX(defendersThen, keeper));
  return Math.max(0, ...teammates.map((teammate) => passValue(spot, whereTheyWillBe(teammate, spot, time, line), keeper, defendersThen, dt)));
}

type Moment = { spot: Point; time: number };

type Stride = Moment & { inTheWay: Opponent[] };

function* runAtGoal(from: Point, speed: number, defenders: Opponent[]): Generator<Stride> {
  const { distance, onwardX, onwardY } = directionTo(from, PITCH_LENGTH, GOAL_CENTRE);
  const touch = MAX_DRIBBLE_TOUCH_SPEED * TOUCH_INTERVAL;
  const inTheWay = new Set<Opponent>();
  for (let carried = touch; carried < distance; carried += touch) {
    const spot: Point = [from[0] + onwardX * carried, from[1] + onwardY * carried, 0];
    const time = timeToRun(carried, MAX_DRIBBLE_TOUCH_SPEED, speed);
    for (const defender of defenders) if (canGetThere(defender, spot, time)) inTheWay.add(defender);
    yield { spot, time, inTheWay: [...inTheWay] };
  }
}

function lastFreeMoment(from: Point, speed: number, defenders: Opponent[]): Moment {
  let lastFree: Moment = { spot: from, time: 0 };
  for (const stride of runAtGoal(from, speed, defenders)) {
    if (stride.inTheWay.length > 0) break;
    lastFree = stride;
  }
  return lastFree;
}

function bestChanceFurtherOn(from: Point, runner: Runner, keeper: Keeper | null, defenders: Opponent[], dt: number, teammates: Teammate[]): number {
  let lastFree: Moment | null = null;
  let best = 0;
  for (const { spot, time, inTheWay } of runAtGoal(from, runner.speed, defenders)) {
    if (inTheWay.length > 0 && lastFree) {
      best = Math.max(best, passingAt(lastFree.spot, lastFree.time, teammates, defenders, keeper, dt));
      lastFree = null;
    }
    if (inTheWay.length === 0) lastFree = { spot, time };
    const gettingThere = chanceOfBeating(inTheWay, runner);
    if (gettingThere <= best) continue;
    best = Math.max(best, gettingThere * bestChanceAroundOnceKeeperIsSet(spot, runner.shooting, keeper !== null, dt));
  }
  return best;
}

function receiverOf(world: Game, eid: number): Receiver {
  const { Position, Velocity, Shooting, Dribbling } = world.components;
  return {
    at: [Position.x[eid]!, Position.y[eid]!],
    moving: [Velocity.x[eid]!, Velocity.y[eid]!],
    shooting: Shooting[eid]!,
    dribbling: Dribbling[eid]!,
    speed: 0,
  };
}

function teammatesOf(world: Game, carrier: number): Teammate[] {
  const { Position, Velocity, Shooting, Dribbling, Supporting, Tackled } = world.components;
  return Array.from(query(world, [Position, Velocity, Shooting, Dribbling, Supporting, Not(Tackled)]))
    .filter((eid) => eid !== carrier)
    .map((eid) => ({ ...receiverOf(world, eid), planned: [Supporting.aheadOfBall[eid]!, Supporting.acrossFromBall[eid]!] }));
}

function wayPast(from: Point, inTheWay: Defender[]): [x: number, y: number] | null {
  const { distance, onwardX, onwardY } = directionTo(from, PITCH_LENGTH, GOAL_CENTRE);
  const nearest = inTheWay
    .map((at) => {
      const along = (at[0] - from[0]) * onwardX + (at[1] - from[1]) * onwardY;
      const across = (at[0] - from[0]) * -onwardY + (at[1] - from[1]) * onwardX;
      return { at, along, across };
    })
    .filter(({ along, across }) => along > 0 && along < distance && Math.abs(across) < PASSING_GAP)
    .sort((a, b) => a.along - b.along)[0];
  if (!nearest) return null;
  const side = nearest.across >= 0 ? -1 : 1;
  const swerve = side * Math.min(SHARPEST_TAKE_ON, Math.atan2(PASSING_GAP - Math.abs(nearest.across), nearest.along));
  const heading = Math.atan2(onwardY, onwardX) + swerve;
  return [from[0] + Math.cos(heading) * distance, from[1] + Math.sin(heading) * distance];
}

function carryOn(world: Game, eid: number, way: [x: number, y: number]): void {
  const { Dribble } = world.components;
  if (!hasComponent(world, eid, Dribble)) setDribble(world, eid, ...way);
  [Dribble.x[eid], Dribble.y[eid]] = way;
}

function whereTheyGetTo({ at, recoversIn, tackling }: Opponent, attempt: { point: Point; shortfall: number } | null): Opponent {
  if (!attempt) return { at, moving: [0, 0], recoversIn, tackling };
  const { distance, onwardX, onwardY } = directionTo([...at, 0], attempt.point[0], attempt.point[1]);
  const moved = Math.max(0, distance - INTERCEPTOR.reach - attempt.shortfall);
  const speed = moved > 0 ? INTERCEPTOR.speed : 0;
  return { at: [at[0] + onwardX * moved, at[1] + onwardY * moved], moving: [onwardX * speed, onwardY * speed], recoversIn: 0, tackling };
}

type Receiver = Runner & { at: [x: number, y: number]; moving: [vx: number, vy: number] };

function passValue(from: Point, receiver: Receiver, keeper: Keeper | null, defenders: Opponent[], dt: number): number {
  const pass = leadPass(from, receiver.at, receiver.moving);
  const flight = pass && passFlight(from, pass, dt);
  if (!pass || !flight) return 0;
  const attempts = defenders.map(({ at, recoversIn }) => interceptionOf(flight, at, dt, recoversIn));
  if (attempts.some((attempt) => attempt && attempt.shortfall <= 0)) return 0;
  const defendersThen = defenders.map((defender, i) => whereTheyGetTo(defender, attempts[i]!));
  const shootingFirstTime = bestChanceAroundOnceKeeperIsSet(pass.to, receiver.shooting, keeper !== null, dt);
  const runningOn = { ...receiver, speed: speedTowards(receiver.moving, [pass.to[0], pass.to[1]], GOAL) };
  return Math.max(shootingFirstTime, bestChanceFurtherOn(pass.to, runningOn, keeper, defendersThen, dt, []));
}

function bestPass(world: Game, passer: number, ball: number, keeper: Keeper | null, defenders: Opponent[], dt: number) {
  const from = pointOf(world.components.Position, ball);
  const { Position, Velocity, Shooting, Dribbling, Supporting, Tackled } = world.components;
  let best: { receiver: number; worth: number } | null = null;
  for (const receiver of query(world, [Position, Velocity, Shooting, Dribbling, Supporting, Not(Tackled)])) {
    if (receiver === passer || !isOnside(world, receiver, ball)) continue;
    const worth = passValue(from, receiverOf(world, receiver), keeper, defenders, dt);
    if (!best || worth > best.worth) best = { receiver, worth };
  }
  return best;
}

export function attack(world: Game, dt: number): void {
  const { Position, Velocity, Shooting, Dribbling, Attacking, Struck, Held, Shot, Passing, Ball } = world.components;
  const ball = query(world, [Ball])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Shooting, Dribbling, Attacking])) {
    if (hasComponent(world, ball, Struck) || hasComponent(world, ball, Held)) {
      removeComponent(world, eid, Attacking);
      continue;
    }
    if (hasComponent(world, eid, Shot) || hasComponent(world, eid, Passing) || !isOnTheBall(world, eid, ball, dt)) continue;
    const from = pointOf(Position, ball);
    const keeper = keeperPosition(world);
    const defenders = opponents(world);
    const now = bestShot(shotOptions(from, Shooting[eid]!, dt), keeper, dt, defenders.map(({ at }) => at));
    const towardsGoal = directionTo(from, PITCH_LENGTH, GOAL_CENTRE);
    const runningAt = Velocity.x[eid]! * towardsGoal.onwardX + Velocity.y[eid]! * towardsGoal.onwardY;
    const runner = { shooting: Shooting[eid]!, dribbling: Dribbling[eid]!, speed: runningAt };
    const later = bestChanceFurtherOn(from, runner, keeper, defenders, dt, teammatesOf(world, eid));
    const pass = bestPass(world, eid, ball, keeper, defenders, dt);
    const passing = pass?.worth ?? 0;
    Attacking.chance[eid] = now.chance;
    Attacking.bestChanceFurtherOn[eid] = later;
    Attacking.bestPass[eid] = passing;
    Attacking.aimY[eid] = now.aim[1];
    Attacking.aimZ[eid] = now.aim[2];
    if (pass && passing > Math.max(now.chance, later) + CLEAR_GAIN_TO_PASS) setPassing(world, eid, pass.receiver);
    else if (now.chance > 0 && now.chance >= later) setShot(world, eid, ...now.aim);
    else carryOn(world, eid, wayPast(from, defenders.map(({ at }) => at)) ?? [PITCH_LENGTH, GOAL_CENTRE]);
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

function raceToBall(world: Game, eid: number, flight: StraightFlight | null, mover: Mover, dt: number): void {
  const { Position, Velocity } = world.components;
  const at: [number, number] = [Position.x[eid]!, Position.y[eid]!];
  const interception = flight && bestInterception(mover, at, flight, (step) => step + 1, dt);
  const gapX = interception ? interception.point[0] - at[0] : 0;
  const gapY = interception ? interception.point[1] - at[1] : 0;
  const gap = Math.hypot(gapX, gapY);
  const speed = gap > 0 ? Math.min(mover.speed, gap / dt) / gap : 0;
  Velocity.x[eid] = gapX * speed;
  Velocity.y[eid] = gapY * speed;
}

function nearestShooter(world: Game, ball: number): number | undefined {
  const { Position, Shooting } = world.components;
  let nearest: number | undefined;
  let nearestDistance = Infinity;
  for (const eid of query(world, [Position, Shooting])) {
    const distance = Math.hypot(Position.x[eid]! - Position.x[ball]!, Position.y[eid]! - Position.y[ball]!);
    if (distance < nearestDistance) [nearest, nearestDistance] = [eid, distance];
  }
  return nearest;
}

function takeUpPosition(world: Game, keeper: number, ball: number, dt: number): void {
  const { Position, Shooting } = world.components;
  const shooter = nearestShooter(world, ball);
  if (shooter === undefined) return;
  const from = pointOf(Position, ball);
  const keeperAt: Keeper = [Position.x[keeper]!, Position.y[keeper]!];
  const spot = whereToStand(from, shotOptions(from, Shooting[shooter]!, dt), keeperAt, dt);
  if (!spot) return;
  setTarget(world, keeper, spot[0], spot[1], 0, 0, Math.atan2(from[1] - spot[1], from[0] - spot[0]));
}

function standStill(world: Game, keeper: number): void {
  const { Velocity, Target } = world.components;
  removeComponent(world, keeper, Target);
  Velocity.x[keeper] = 0;
  Velocity.y[keeper] = 0;
}

export function goalkeep(world: Game, dt: number): void {
  const { Position, Velocity, Goalkeeper, Struck, Held, Ball } = world.components;
  const ball = query(world, [Ball])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Velocity, Goalkeeper])) {
    if (hasComponent(world, ball, Struck)) {
      standStill(world, eid);
      if (hasReacted(KEEPER, Goalkeeper.watchingShotFor[eid]!, dt)) {
        raceToBall(world, eid, straightFlight(pointOf(Position, ball), pointOf(Velocity, ball), dt), KEEPER, dt);
      }
      Goalkeeper.watchingShotFor[eid] = Goalkeeper.watchingShotFor[eid]! + dt;
      continue;
    }
    Goalkeeper.watchingShotFor[eid] = 0;
    if (hasComponent(world, ball, Held)) standStill(world, eid);
    else takeUpPosition(world, eid, ball, dt);
  }
}

export function save(world: Game, dt: number): void {
  const { Position, Velocity, Goalkeeper, Held, Struck, Ball } = world.components;
  for (const ball of query(world, [Ball, Position, Velocity, Not(Held)])) {
    for (const keeper of query(world, [Position, Goalkeeper])) {
      const keeperX = Position.x[keeper]!;
      const keeperY = Position.y[keeper]!;
      const nearest = closestPassThisStep(keeperX, keeperY, pointOf(Position, ball), pointOf(Velocity, ball), dt);
      if (!isWithinReach(KEEPER, [keeperX, keeperY], nearest)) continue;
      [Position.x[ball], Position.y[ball], Position.z[ball]] = nearest;
      [Velocity.x[ball], Velocity.y[ball], Velocity.z[ball]] = [0, 0, 0];
      removeComponent(world, ball, Struck);
      addComponent(world, ball, Held);
      break;
    }
  }
}

export function step(world: Game, dt = TIME_STEP): void {
  attack(world, dt);
  dribble(world, dt);
  shoot(world);
  pass(world);
  support(world, dt);
  meetPass(world, dt);
  defend(world, dt);
  goalkeep(world, dt);
  runToTarget(world, dt);
  roll(world, dt);
  fly(world, dt);
  move(world, dt);
  block(world, dt);
  intercept(world, dt);
  receive(world);
  save(world, dt);
  watchGoalLine(world);
}

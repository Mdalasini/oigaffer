import { addComponent, hasComponent, Not, query, removeComponent } from "bitecs";
import {
  ACCELERATION,
  BALL_ROLLING_DECELERATION,
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
  SHARPEST_TAKE_ON,
  STANDING_SPEED,
  OFFER_SWITCH_GAIN,
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
import { bestShot, shotOptions, whereToStand } from "./chance";
import { isWithinBlockingReach, tackleWinChance, type Defender } from "./defender";
import { GOAL_CENTRE } from "./goal";
import { bestInterception, hasReacted, isWithinReach, type Mover } from "./interception";
import { INTERCEPTOR, leadPass, untilCollected } from "./passing";
import { KEEPER, type Keeper } from "./keeper";
import { directionTo } from "./direction";
import { bestChanceFurtherOn, passValue, type Opponent, type TeammateRun } from "./valuation";
import { nearestOffer, offerAim, offerValue, OFFERS, receiverOnTheRun, withBallHeadingTo, type Offer, type Scene } from "./offering";
import { accelerated, angleBetween, steer, stoppingSpeed, turnTowards, type Body } from "./running";
import { attackingDirectionOf, goalAttackedBy, goalDefendedBy, opponentsOf, teammatesOf } from "./teams";
import { kick, missAim, spreadRadius, strikeSpeed, type Point } from "./shooting";
import { setAttacking, setDribble, setPassing, setShot, setTarget, strikeBall, type Game } from "./world";

const pointOf = (part: { x: number[]; y: number[]; z: number[] }, eid: number): Point => [part.x[eid]!, part.y[eid]!, part.z[eid]!];

function accelerateTowards(world: Game, eid: number, wantX: number, wantY: number, dt: number): void {
  const { Velocity } = world.components;
  [Velocity.x[eid], Velocity.y[eid]] = accelerated(Velocity.x[eid]!, Velocity.y[eid]!, wantX, wantY, dt);
}

export function runToTarget(world: Game, dt: number): void {
  const { Position, Velocity, Target, Facing } = world.components;
  for (const eid of query(world, [Position, Velocity, Target, Facing])) {
    const { body, arrived } = steer(
      { x: Position.x[eid]!, y: Position.y[eid]!, vx: Velocity.x[eid]!, vy: Velocity.y[eid]!, facing: Facing[eid]! },
      { x: Target.x[eid]!, y: Target.y[eid]!, vx: Target.vx[eid]!, vy: Target.vy[eid]!, arrivalFacing: Target.arrivalFacing[eid]! },
      dt,
    );
    [Position.x[eid], Position.y[eid], Velocity.x[eid], Velocity.y[eid], Facing[eid]] = [body.x, body.y, body.vx, body.vy, body.facing];
    if (arrived) removeComponent(world, eid, Target);
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

function nearestDribbler(world: Game, defender: number, ball: number): number | undefined {
  const { Position, Dribbling, Tackled } = world.components;
  let nearest: number | undefined;
  let nearestDistance = Infinity;
  for (const eid of opponentsOf(world, defender, [Position, Dribbling, Not(Tackled)])) {
    const distance = Math.hypot(Position.x[eid]! - Position.x[ball]!, Position.y[eid]! - Position.y[ball]!);
    if (distance < nearestDistance) [nearest, nearestDistance] = [eid, distance];
  }
  return nearest;
}

function loseTheBall(world: Game, attacker: number, ball: number): void {
  const { Position, Velocity, Attacking, Dribble, Shot, Tackled } = world.components;
  const { onwardX, onwardY } = directionTo([...goalAttackedBy(world, attacker), 0], Position.x[ball]!, Position.y[ball]!);
  Velocity.x[ball] = onwardX * TACKLE_CLEARANCE_SPEED;
  Velocity.y[ball] = onwardY * TACKLE_CLEARANCE_SPEED;
  removeComponent(world, attacker, Attacking);
  removeComponent(world, attacker, Dribble);
  removeComponent(world, attacker, Shot);
  removeComponent(world, attacker, world.components.Passing);
  addComponent(world, attacker, Tackled);
  loseTheBallFor(world, attacker);
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
  const { onwardX, onwardY } = directionTo(from, ...goalDefendedBy(world, defender));
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
    const attacker = nearestDribbler(world, eid, ball);
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
  const { Position, Velocity, Attacking, Passing, Passed, Receiving, WatchingPassFor } = world.components;
  const pass = leadPass(pointOf(Position, ball), [Position.x[receiver]!, Position.y[receiver]!], [Velocity.x[receiver]!, Velocity.y[receiver]!]);
  removeComponent(world, passer, Passing);
  if (!pass) return false;
  [Velocity.x[ball], Velocity.y[ball], Velocity.z[ball]] = pass.velocity;
  addComponent(world, ball, Passed);
  [Passed.x[ball], Passed.y[ball]] = [pass.to[0], pass.to[1]];
  for (const defender of query(world, [WatchingPassFor])) WatchingPassFor[defender] = 0;
  removeComponent(world, passer, Attacking);
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

function secondLastOpponent(world: Game, eid: number): number | undefined {
  const { Position } = world.components;
  const forward = attackingDirectionOf(world, eid);
  return opponentsOf(world, eid, [Position]).sort((a, b) => forward * (Position.x[b]! - Position.x[a]!))[1];
}

function isOnside(world: Game, eid: number, ball: number): boolean {
  const { Position } = world.components;
  const forward = attackingDirectionOf(world, eid);
  const opponent = secondLastOpponent(world, eid);
  const line = opponent === undefined ? goalAttackedBy(world, eid)[0] : Position.x[opponent]!;
  return forward * Position.x[eid]! <= Math.max(forward * Position.x[ball]!, forward * line);
}

function sceneFor(world: Game, supporter: number, ball: number): Scene {
  const { Position, Velocity, Attacking, Tackling } = world.components;
  const carrier = teammatesOf(world, supporter, [Position, Velocity, Attacking])[0];
  const moving = carrier ?? ball;
  return {
    ball: [Position.x[ball]!, Position.y[ball]!],
    path: [Velocity.x[moving]!, Velocity.y[moving]!],
    carried: carrier !== undefined,
    forward: attackingDirectionOf(world, supporter),
    defenders: opponents(world, supporter),
    standingOpponents: opponentsOf(world, supporter, [Position, Not(Tackling)]).map((eid): [number, number] => [Position.x[eid]!, Position.y[eid]!]),
    keeper: opposingKeeper(world, supporter),
  };
}

const bodyOf = (world: Game, eid: number): Body => {
  const { Position, Velocity, Facing } = world.components;
  return { x: Position.x[eid]!, y: Position.y[eid]!, vx: Velocity.x[eid]!, vy: Velocity.y[eid]!, facing: Facing[eid]! };
};

function reconsider(world: Game, eid: number, scene: Scene, dt: number): void {
  const { Supporting, Shooting, Dribbling } = world.components;
  const body = bodyOf(world, eid);
  const runner = { shooting: Shooting[eid]!, dribbling: Dribbling[eid]!, speed: 0 };
  const held = heldOffer(world, eid, scene);
  [Supporting.along[eid], Supporting.across[eid]] = [held.along, held.across];
  const next = Supporting.next[eid]!;
  const candidate = OFFERS[next]!;
  if (offerValue(body, candidate, scene, runner, dt) > offerValue(body, held, scene, runner, dt) + OFFER_SWITCH_GAIN) {
    [Supporting.along[eid], Supporting.across[eid]] = [candidate.along, candidate.across];
  }
  Supporting.next[eid] = (next + 1) % OFFERS.length;
}

export function support(world: Game, dt: number): void {
  const { Position, Supporting, Shooting, Dribbling, Receiving, Tackled, Ball } = world.components;
  const ball = query(world, [Ball])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Shooting, Dribbling, Supporting, Not(Receiving), Not(Tackled)])) {
    const scene = sceneFor(world, eid, ball);
    reconsider(world, eid, scene, dt);
    const aim = offerAim({ along: Supporting.along[eid]!, across: Supporting.across[eid]! }, scene, 0);
    setTarget(world, eid, aim.x, aim.y, aim.vx, aim.vy);
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
      const { onwardX, onwardY } = directionTo([...goalDefendedBy(world, defender), 0], nearest[0], nearest[1]);
      [Velocity.x[ball], Velocity.y[ball], Velocity.z[ball]] = [onwardX * TACKLE_CLEARANCE_SPEED, onwardY * TACKLE_CLEARANCE_SPEED, 0];
      removeComponent(world, ball, Passed);
      addComponent(world, ball, Intercepted);
      for (const receiver of query(world, [Position, Receiving])) {
        loseTheBallFor(world, receiver);
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

function opposingKeeper(world: Game, eid: number): Keeper | null {
  const { Position, Goalkeeper } = world.components;
  const keeper = opponentsOf(world, eid, [Position, Goalkeeper])[0];
  return keeper === undefined ? null : [Position.x[keeper]!, Position.y[keeper]!];
}

function isOnTheBall(world: Game, eid: number, ball: number, dt: number): boolean {
  const { Position, Dribble } = world.components;
  const ready = !hasComponent(world, eid, Dribble) || Dribble.nextTouchIn[eid]! <= dt;
  return ready && Math.hypot(Position.x[ball]! - Position.x[eid]!, Position.y[ball]! - Position.y[eid]!) <= TOUCH_REACH;
}

function opponents(world: Game, attacker: number): Opponent[] {
  const { Position, Velocity, Tackling, Grounded } = world.components;
  return opponentsOf(world, attacker, [Position, Velocity, Tackling]).map((eid): Opponent => ({
    at: [Position.x[eid]!, Position.y[eid]!],
    moving: [Velocity.x[eid]!, Velocity.y[eid]!],
    tackling: Tackling[eid]!,
    recoversIn: hasComponent(world, eid, Grounded) ? Grounded.recoversIn[eid]! : 0,
  }));
}

const heldOffer = (world: Game, eid: number, scene: Scene): Offer => {
  const { Position, Supporting } = world.components;
  return Number.isNaN(Supporting.along[eid]!)
    ? nearestOffer([Position.x[eid]!, Position.y[eid]!], scene)
    : { along: Supporting.along[eid]!, across: Supporting.across[eid]! };
};

function teammateRunFor(world: Game, carrier: number, ball: number, dt: number): TeammateRun | null {
  const { Position, Shooting, Dribbling, Supporting, Tackled } = world.components;
  const teammate = teammatesOf(world, carrier, [Position, Shooting, Dribbling, Supporting, Not(Tackled)])[0];
  if (teammate === undefined) return null;
  const scene = sceneFor(world, teammate, ball);
  const body = bodyOf(world, teammate);
  const offer = heldOffer(world, teammate, scene);
  const runner = { shooting: Shooting[teammate]!, dribbling: Dribbling[teammate]!, speed: 0 };
  return (ballTo, time) => receiverOnTheRun(body, offer, withBallHeadingTo(scene, ballTo, time), runner, time, dt);
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

function passWorth(world: Game, from: Point, receiver: number, keeper: Keeper | null, defenders: Opponent[], dt: number): number {
  const { Position, Velocity, Shooting, Dribbling } = world.components;
  return passValue(
    from,
    {
      at: [Position.x[receiver]!, Position.y[receiver]!],
      moving: [Velocity.x[receiver]!, Velocity.y[receiver]!],
      shooting: Shooting[receiver]!,
      dribbling: Dribbling[receiver]!,
      speed: 0,
    },
    keeper,
    defenders,
    dt,
  );
}

function bestPass(world: Game, passer: number, ball: number, keeper: Keeper | null, defenders: Opponent[], dt: number) {
  const from = pointOf(world.components.Position, ball);
  const { Position, Velocity, Shooting, Dribbling, Supporting, Tackled } = world.components;
  let best: { receiver: number; worth: number } | null = null;
  for (const receiver of teammatesOf(world, passer, [Position, Velocity, Shooting, Dribbling, Supporting, Not(Tackled)])) {
    if (!isOnside(world, receiver, ball)) continue;
    const worth = passWorth(world, from, receiver, keeper, defenders, dt);
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
    const keeper = opposingKeeper(world, eid);
    const defenders = opponents(world, eid);
    const now = bestShot(shotOptions(from, Shooting[eid]!, dt), keeper, dt, defenders.map(({ at }) => at));
    const towardsGoal = directionTo(from, PITCH_LENGTH, GOAL_CENTRE);
    const runningAt = Velocity.x[eid]! * towardsGoal.onwardX + Velocity.y[eid]! * towardsGoal.onwardY;
    const runner = { shooting: Shooting[eid]!, dribbling: Dribbling[eid]!, speed: runningAt };
    const later = bestChanceFurtherOn(from, runner, keeper, defenders, dt, teammateRunFor(world, eid, ball, dt));
    const pass = bestPass(world, eid, ball, keeper, defenders, dt);
    const passing = pass?.worth ?? 0;
    Attacking.chance[eid] = now.chance;
    Attacking.bestChanceFurtherOn[eid] = later;
    Attacking.bestPass[eid] = passing;
    Attacking.aimY[eid] = now.aim[1];
    Attacking.aimZ[eid] = now.aim[2];
    if (now.chance === 1 || (now.chance > 0 && now.chance >= later && now.chance >= passing)) setShot(world, eid, ...now.aim);
    else if (pass && passing > later) setPassing(world, eid, pass.receiver);
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

function nearestShooter(world: Game, keeper: number, ball: number): number | undefined {
  const { Position, Shooting } = world.components;
  let nearest: number | undefined;
  let nearestDistance = Infinity;
  for (const eid of opponentsOf(world, keeper, [Position, Shooting])) {
    const distance = Math.hypot(Position.x[eid]! - Position.x[ball]!, Position.y[eid]! - Position.y[ball]!);
    if (distance < nearestDistance) [nearest, nearestDistance] = [eid, distance];
  }
  return nearest;
}

function takeUpPosition(world: Game, keeper: number, ball: number, dt: number): void {
  const { Position, Shooting } = world.components;
  const shooter = nearestShooter(world, keeper, ball);
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

const isInPossession = (world: Game, eid: number) => hasComponent(world, world.components.PlaysFor[eid]!, world.components.InPossession);

function loseTheBallFor(world: Game, eid: number): void {
  const { PlaysFor, InPossession } = world.components;
  if (hasComponent(world, eid, PlaysFor)) removeComponent(world, PlaysFor[eid]!, InPossession);
}

function startOffering(world: Game, eid: number): void {
  const { Supporting } = world.components;
  addComponent(world, eid, Supporting);
  [Supporting.along[eid], Supporting.across[eid], Supporting.next[eid]] = [NaN, NaN, 0];
}

export function contribute(world: Game): void {
  const { Position, Dribbling, PlaysFor, Attacking, Dribble, Shot, Passing, Receiving, Supporting, Tackled } = world.components;
  for (const eid of query(world, [Position, Dribbling, PlaysFor])) {
    const offTheBall = ![Attacking, Dribble, Shot, Passing, Receiving, Tackled].some((part) => hasComponent(world, eid, part));
    if (!isInPossession(world, eid) || !offTheBall) removeComponent(world, eid, Supporting);
    else if (!hasComponent(world, eid, Supporting)) startOffering(world, eid);
  }
}

export function step(world: Game, dt = TIME_STEP): void {
  contribute(world);
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

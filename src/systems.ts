import { addComponent, hasComponent, Not, query, removeComponent } from "bitecs";
import {
  ACCELERATION,
  ARRIVAL_DISTANCE,
  BRAKING,
  DISTANCE_BEHIND_BALL,
  DRIBBLE_BRAKING,
  DRIBBLE_STOP_DISTANCE,
  GOAL_SIDE_DISTANCE,
  KEEPER_DIVE_SPEED,
  KEEPER_HIGHEST_REACH,
  KEEPER_REACH,
  MAX_DRIBBLE_TOUCH_SPEED,
  MAX_TOUCH_SPEED_AWAY_FROM_PLAYER,
  PASSING_GAP,
  PITCH_LENGTH,
  SHARPEST_TAKE_ON,
  SIDEWAYS_SPEED,
  STANDING_SPEED,
  TACKLE_CLEARANCE_SPEED,
  TACKLE_REACH,
  TACKLE_RECOVERY_TIME,
  TIME_STEP,
  TOP_SPEED,
  TOUCH_INTERVAL,
  TOUCH_REACH,
  TURN_RATE,
} from "./constants";
import { closestPassThisStep, crossing, flying, GOAL_LINE, isOnTheGround, rolling, straightFlight } from "./flight";
import { bestShot, shotOptions, whereToStand } from "./chance";
import { isWithinBlockingReach, tackleWinChance, timeToRun, type Defender } from "./defender";
import { GOAL_CENTRE } from "./goal";
import { bestInterception, hasReacted, isWithinReach } from "./interception";
import { KEEPER, type Keeper } from "./keeper";
import { kick, missAim, spreadRadius, strikeSpeed, type Point } from "./shooting";
import { setDribble, setShot, setTarget, strikeBall, type Game } from "./world";

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
  [world.components.Struck, world.components.Held, world.components.Blocked].every((part) => !hasComponent(world, ball, part));

export function defend(world: Game, dt: number): void {
  const { Position, Tackling, Grounded, Ball } = world.components;
  const ball = query(world, [Ball])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Tackling])) {
    if (hasComponent(world, eid, Grounded)) {
      standStill(world, eid);
      Grounded.recoversIn[eid] = Grounded.recoversIn[eid]! - dt;
      if (Grounded.recoversIn[eid]! <= 0) removeComponent(world, eid, Grounded);
      continue;
    }
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

type Opponent = { at: Defender; tackling: number; recoversIn: number };

function opponents(world: Game): Opponent[] {
  const { Position, Tackling, Grounded } = world.components;
  return Array.from(query(world, [Position, Tackling]), (eid): Opponent => ({
    at: [Position.x[eid]!, Position.y[eid]!],
    tackling: Tackling[eid]!,
    recoversIn: hasComponent(world, eid, Grounded) ? Grounded.recoversIn[eid]! : 0,
  }));
}

function chanceOfGettingThere(spot: Point, carried: number, dribbling: number, defenders: Opponent[]): number {
  const timeThere = timeToRun(carried, MAX_DRIBBLE_TOUCH_SPEED);
  return defenders
    .filter(({ at, recoversIn }) => recoversIn + timeToRun(Math.max(0, Math.hypot(spot[0] - at[0], spot[1] - at[1]) - TACKLE_REACH), TOP_SPEED) <= timeThere)
    .reduce((chance, { tackling }) => chance * (1 - tackleWinChance(tackling, dribbling)), 1);
}

function bestChanceFurtherOn(from: Point, shooting: number, dribbling: number, keeper: Keeper | null, defenders: Opponent[], dt: number): number {
  const { distance, onwardX, onwardY } = directionTo(from, PITCH_LENGTH, GOAL_CENTRE);
  const touch = MAX_DRIBBLE_TOUCH_SPEED * TOUCH_INTERVAL;
  let best = 0;
  for (let carried = touch; carried < distance; carried += touch) {
    const next: Point = [from[0] + onwardX * carried, from[1] + onwardY * carried, 0];
    const gettingThere = chanceOfGettingThere(next, carried, dribbling, defenders);
    if (gettingThere <= best) continue;
    const options = shotOptions(next, shooting, dt);
    const setKeeper = keeper && (whereToStand(next, options, keeper, dt) ?? keeper);
    best = Math.max(best, gettingThere * bestShot(options, setKeeper, dt).chance);
  }
  return best;
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

export function attack(world: Game, dt: number): void {
  const { Position, Shooting, Dribbling, Attacking, Struck, Held, Shot, Ball } = world.components;
  const ball = query(world, [Ball])[0];
  if (ball === undefined) return;
  for (const eid of query(world, [Position, Shooting, Dribbling, Attacking])) {
    if (hasComponent(world, ball, Struck) || hasComponent(world, ball, Held)) {
      removeComponent(world, eid, Attacking);
      continue;
    }
    if (hasComponent(world, eid, Shot) || !isOnTheBall(world, eid, ball, dt)) continue;
    const from = pointOf(Position, ball);
    const keeper = keeperPosition(world);
    const defenders = opponents(world);
    const now = bestShot(shotOptions(from, Shooting[eid]!, dt), keeper, dt, defenders.map(({ at }) => at));
    const later = bestChanceFurtherOn(from, Shooting[eid]!, Dribbling[eid]!, keeper, defenders, dt);
    Attacking.chance[eid] = now.chance;
    Attacking.bestChanceFurtherOn[eid] = later;
    Attacking.aimY[eid] = now.aim[1];
    Attacking.aimZ[eid] = now.aim[2];
    if (now.chance === 1 || (now.chance > 0 && now.chance >= later)) setShot(world, eid, ...now.aim);
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

function diveForBall(world: Game, keeper: number, ball: number, dt: number): void {
  const { Position, Velocity } = world.components;
  const keeperAt: Keeper = [Position.x[keeper]!, Position.y[keeper]!];
  const flight = straightFlight(pointOf(Position, ball), pointOf(Velocity, ball), dt);
  const interception = flight && bestInterception(KEEPER, keeperAt, flight, (step) => step + 1, dt);
  const gapX = interception ? interception.point[0] - keeperAt[0] : 0;
  const gapY = interception ? interception.point[1] - keeperAt[1] : 0;
  const gap = Math.hypot(gapX, gapY);
  const speed = gap > 0 ? Math.min(KEEPER_DIVE_SPEED, gap / dt) / gap : 0;
  Velocity.x[keeper] = gapX * speed;
  Velocity.y[keeper] = gapY * speed;
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
      if (hasReacted(KEEPER, Goalkeeper.watchingShotFor[eid]!, dt)) diveForBall(world, eid, ball, dt);
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
  defend(world, dt);
  goalkeep(world, dt);
  runToTarget(world, dt);
  roll(world, dt);
  fly(world, dt);
  move(world, dt);
  block(world, dt);
  save(world, dt);
  watchGoalLine(world);
}

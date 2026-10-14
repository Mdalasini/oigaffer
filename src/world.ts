import { addComponent, addEntity, createWorld, hasComponent, removeComponent } from "bitecs";
import { AVERAGE_GRADE, AVERAGE_SHOOTING_GRADE } from "./constants";
import { seededRandom } from "./random";
import type { Point } from "./shooting";

export const ANY_FACING = NaN;

export function createGame(seed = 1) {
  return createWorld({
    random: seededRandom(seed),
    components: {
      Position: { x: [] as number[], y: [] as number[], z: [] as number[] },
      Velocity: { x: [] as number[], y: [] as number[], z: [] as number[] },
      Facing: [] as number[],
      Shooting: [] as number[],
      Dribbling: [] as number[],
      Tackling: [] as number[],
      Grounded: { recoversIn: [] as number[] },
      Tackled: {},
      Blocked: {},
      Passing: { to: [] as number[] },
      Passed: { x: [] as number[], y: [] as number[] },
      Receiving: {},
      Supporting: { along: [] as number[], across: [] as number[], next: [] as number[] },
      Intercepted: {},
      WatchingPassFor: [] as number[],
      Target: {
        x: [] as number[],
        y: [] as number[],
        vx: [] as number[],
        vy: [] as number[],
        arrivalFacing: [] as number[],
      },
      Dribble: { x: [] as number[], y: [] as number[], nextTouchIn: [] as number[] },
      Shot: { x: [] as number[], y: [] as number[], z: [] as number[] },
      Attacking: {
        chance: [] as number[],
        bestChanceFurtherOn: [] as number[],
        bestPass: [] as number[],
        aimY: [] as number[],
        aimZ: [] as number[],
      },
      GoalLineCrossing: { y: [] as number[], z: [] as number[] },
      Goalkeeper: { watchingShotFor: [] as number[] },
      Held: {},
      Struck: {},
      Ball: {},
      Team: { attackingDirection: [] as number[] },
      InPossession: {},
      PlaysFor: [] as number[],
    },
  });
}

export type Game = ReturnType<typeof createGame>;

function addBody(world: Game, x: number, y: number, facing: number): number {
  const { Position, Velocity, Facing } = world.components;
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, Velocity);
  addComponent(world, eid, Facing);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = 0;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Velocity.z[eid] = 0;
  Facing[eid] = facing;
  return eid;
}

export function addPlayer(
  world: Game,
  x: number,
  y: number,
  facing = 0,
  shooting = AVERAGE_SHOOTING_GRADE,
  dribbling = AVERAGE_GRADE,
): number {
  const { Shooting, Dribbling } = world.components;
  const eid = addBody(world, x, y, facing);
  addComponent(world, eid, Shooting);
  addComponent(world, eid, Dribbling);
  Shooting[eid] = shooting;
  Dribbling[eid] = dribbling;
  return eid;
}

export function addDefender(world: Game, x: number, y: number, facing = Math.PI, tackling = AVERAGE_GRADE): number {
  const { Tackling, WatchingPassFor } = world.components;
  const eid = addBody(world, x, y, facing);
  addComponent(world, eid, Tackling);
  addComponent(world, eid, WatchingPassFor);
  Tackling[eid] = tackling;
  WatchingPassFor[eid] = 0;
  return eid;
}

export function addGoalkeeper(world: Game, x: number, y: number, facing = Math.PI): number {
  const { Goalkeeper } = world.components;
  const eid = addBody(world, x, y, facing);
  addComponent(world, eid, Goalkeeper);
  Goalkeeper.watchingShotFor[eid] = 0;
  return eid;
}

export function addBall(world: Game, x: number, y: number): number {
  const { Position, Velocity, Ball } = world.components;
  const eid = addEntity(world);
  addComponent(world, eid, Ball);
  addComponent(world, eid, Position);
  addComponent(world, eid, Velocity);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = 0;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Velocity.z[eid] = 0;
  return eid;
}

export function setTarget(
  world: Game,
  eid: number,
  x: number,
  y: number,
  vx = 0,
  vy = 0,
  arrivalFacing = ANY_FACING,
): void {
  const { Target } = world.components;
  addComponent(world, eid, Target);
  Target.x[eid] = x;
  Target.y[eid] = y;
  Target.vx[eid] = vx;
  Target.vy[eid] = vy;
  Target.arrivalFacing[eid] = arrivalFacing;
}

export function setDribble(world: Game, eid: number, x: number, y: number): void {
  const { Dribble, Shot, Passing } = world.components;
  removeComponent(world, eid, Shot);
  removeComponent(world, eid, Passing);
  addComponent(world, eid, Dribble);
  Dribble.x[eid] = x;
  Dribble.y[eid] = y;
  Dribble.nextTouchIn[eid] = 0;
}

export function setShot(world: Game, eid: number, x: number, y: number, z: number): void {
  const { Shot, Dribble, Passing } = world.components;
  removeComponent(world, eid, Dribble);
  removeComponent(world, eid, Passing);
  addComponent(world, eid, Shot);
  Shot.x[eid] = x;
  Shot.y[eid] = y;
  Shot.z[eid] = z;
}

export function strikeBall(world: Game, ball: number, [vx, vy, vz]: Point): void {
  const { Velocity, Struck } = world.components;
  Velocity.x[ball] = vx;
  Velocity.y[ball] = vy;
  Velocity.z[ball] = vz;
  addComponent(world, ball, Struck);
}

export function setAttacking(world: Game, eid: number): void {
  const { Attacking, PlaysFor } = world.components;
  addComponent(world, eid, Attacking);
  if (hasComponent(world, eid, PlaysFor)) setInPossession(world, PlaysFor[eid]!);
  Attacking.chance[eid] = 0;
  Attacking.bestChanceFurtherOn[eid] = 0;
  Attacking.bestPass[eid] = 0;
  Attacking.aimY[eid] = NaN;
  Attacking.aimZ[eid] = NaN;
}

export function setPassing(world: Game, eid: number, to: number): void {
  const { Passing, Dribble, Shot } = world.components;
  removeComponent(world, eid, Dribble);
  removeComponent(world, eid, Shot);
  addComponent(world, eid, Passing);
  Passing.to[eid] = to;
}


export const UP_THE_PITCH = 1;
export const DOWN_THE_PITCH = -1;

export function addTeam(world: Game, attackingDirection: typeof UP_THE_PITCH | typeof DOWN_THE_PITCH): number {
  const { Team } = world.components;
  const team = addEntity(world);
  addComponent(world, team, Team);
  Team.attackingDirection[team] = attackingDirection;
  return team;
}

export function joinTeam(world: Game, eid: number, team: number): number {
  const { PlaysFor } = world.components;
  addComponent(world, eid, PlaysFor);
  PlaysFor[eid] = team;
  return eid;
}

export function setInPossession(world: Game, team: number): void {
  addComponent(world, team, world.components.InPossession);
}

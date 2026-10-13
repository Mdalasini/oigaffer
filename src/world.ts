import { addComponent, addEntity, createWorld, removeComponent } from "bitecs";
import { AVERAGE_SHOOTING_GRADE } from "./constants";
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
      Target: {
        x: [] as number[],
        y: [] as number[],
        vx: [] as number[],
        vy: [] as number[],
        arrivalFacing: [] as number[],
      },
      Dribble: { x: [] as number[], y: [] as number[], nextTouchIn: [] as number[] },
      Shot: { x: [] as number[], y: [] as number[], z: [] as number[] },
      GoalLineCrossing: { y: [] as number[], z: [] as number[] },
      Goalkeeper: { watchingShotFor: [] as number[] },
      Held: {},
      Struck: {},
      Ball: {},
    },
  });
}

export type Game = ReturnType<typeof createGame>;

export function addPlayer(world: Game, x: number, y: number, facing = 0, shooting = AVERAGE_SHOOTING_GRADE): number {
  const { Position, Velocity, Facing, Shooting } = world.components;
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, Velocity);
  addComponent(world, eid, Facing);
  addComponent(world, eid, Shooting);
  Shooting[eid] = shooting;
  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = 0;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Velocity.z[eid] = 0;
  Facing[eid] = facing;
  return eid;
}

export function addGoalkeeper(world: Game, x: number, y: number, facing = Math.PI): number {
  const { Position, Velocity, Facing, Goalkeeper } = world.components;
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, Velocity);
  addComponent(world, eid, Facing);
  addComponent(world, eid, Goalkeeper);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = 0;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Velocity.z[eid] = 0;
  Facing[eid] = facing;
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
  const { Dribble, Shot } = world.components;
  removeComponent(world, eid, Shot);
  addComponent(world, eid, Dribble);
  Dribble.x[eid] = x;
  Dribble.y[eid] = y;
  Dribble.nextTouchIn[eid] = 0;
}

export function setShot(world: Game, eid: number, x: number, y: number, z: number): void {
  const { Shot, Dribble } = world.components;
  removeComponent(world, eid, Dribble);
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

import { addComponent, addEntity, createWorld, removeComponent } from "bitecs";

export const ANY_FACING = NaN;

export const ShotType = { Ground: 0, Driven: 1, Chipped: 2 } as const;
export type ShotType = (typeof ShotType)[keyof typeof ShotType];

export function createGame() {
  return createWorld({
    components: {
      Position: { x: [] as number[], y: [] as number[], z: [] as number[] },
      Velocity: { x: [] as number[], y: [] as number[], z: [] as number[] },
      Facing: [] as number[],
      Target: {
        x: [] as number[],
        y: [] as number[],
        vx: [] as number[],
        vy: [] as number[],
        arrivalFacing: [] as number[],
      },
      Dribble: { x: [] as number[], y: [] as number[], nextTouchIn: [] as number[] },
      Shot: { x: [] as number[], y: [] as number[], z: [] as number[], speed: [] as number[], type: [] as ShotType[] },
      GoalLineCrossing: { y: [] as number[], z: [] as number[] },
      Ball: {},
    },
  });
}

export type Game = ReturnType<typeof createGame>;

export function addPlayer(world: Game, x: number, y: number, facing = 0): number {
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

export function setShot(world: Game, eid: number, x: number, y: number, z: number, speed: number, type: ShotType): void {
  const { Shot, Dribble } = world.components;
  removeComponent(world, eid, Dribble);
  addComponent(world, eid, Shot);
  Shot.x[eid] = x;
  Shot.y[eid] = y;
  Shot.z[eid] = z;
  Shot.speed[eid] = speed;
  Shot.type[eid] = type;
}

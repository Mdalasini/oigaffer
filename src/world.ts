import { addComponent, addEntity, createWorld } from "bitecs";

export function createGame() {
  return createWorld({
    components: {
      Position: { x: [] as number[], y: [] as number[] },
      Velocity: { x: [] as number[], y: [] as number[] },
      Facing: [] as number[],
      Target: { x: [] as number[], y: [] as number[], vx: [] as number[], vy: [] as number[], face: [] as number[] }, // a point to run to, which may be moving, and which way to face there (NaN: any)
      Dribble: { x: [] as number[], y: [] as number[], ready: [] as number[] }, // where a player is taking the ball, and s until their next touch
      Ball: {}, // tag
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
  Facing[eid] = facing;
  Position.x[eid] = x;
  Position.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  return eid;
}

export function setTarget(world: Game, eid: number, x: number, y: number, vx = 0, vy = 0, face = NaN): void {
  const { Target } = world.components;
  addComponent(world, eid, Target);
  Target.x[eid] = x;
  Target.y[eid] = y;
  Target.vx[eid] = vx;
  Target.vy[eid] = vy;
  Target.face[eid] = face;
}

export function setDribble(world: Game, eid: number, x: number, y: number): void {
  const { Dribble } = world.components;
  addComponent(world, eid, Dribble);
  Dribble.x[eid] = x;
  Dribble.y[eid] = y;
  Dribble.ready[eid] = 0;
}

export function addBall(world: Game, x: number, y: number): number {
  const { Position, Velocity, Ball } = world.components;
  const eid = addEntity(world);
  addComponent(world, eid, Ball);
  addComponent(world, eid, Position);
  addComponent(world, eid, Velocity);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  return eid;
}

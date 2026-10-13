import { addComponent, addEntity, createWorld } from "bitecs";

export function createGame() {
  return createWorld({
    components: {
      Position: { x: [] as number[], y: [] as number[] },
      Velocity: { x: [] as number[], y: [] as number[] },
      Target: { x: [] as number[], y: [] as number[] },
    },
  });
}

export type Game = ReturnType<typeof createGame>;

export function addPlayer(world: Game, x: number, y: number): number {
  const { Position, Velocity } = world.components;
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, Velocity);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  return eid;
}

export function setTarget(world: Game, eid: number, x: number, y: number): void {
  const { Target } = world.components;
  addComponent(world, eid, Target);
  Target.x[eid] = x;
  Target.y[eid] = y;
}

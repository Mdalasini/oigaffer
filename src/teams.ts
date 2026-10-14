import { hasComponent, query, type QueryTerm } from "bitecs";
import type { Game } from "./world";

const belongsToATeam = (world: Game, eid: number) => hasComponent(world, eid, world.components.PlaysFor);

export function teammatesOf(world: Game, eid: number, terms: QueryTerm[]): number[] {
  const { PlaysFor } = world.components;
  if (!belongsToATeam(world, eid)) return [];
  return Array.from(query(world, [PlaysFor, ...terms])).filter((other) => other !== eid && PlaysFor[other] === PlaysFor[eid]);
}

export function opponentsOf(world: Game, eid: number, terms: QueryTerm[]): number[] {
  const { PlaysFor } = world.components;
  if (!belongsToATeam(world, eid)) return [];
  return Array.from(query(world, [PlaysFor, ...terms])).filter((other) => PlaysFor[other] !== PlaysFor[eid]);
}

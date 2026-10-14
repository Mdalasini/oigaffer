import { hasComponent, query, type QueryTerm } from "bitecs";
import { PITCH_LENGTH } from "./constants";
import { GOAL_CENTRE } from "./goal";
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

export function attackingDirectionOf(world: Game, eid: number): number {
  const { Team, PlaysFor } = world.components;
  return Team.attackingDirection[PlaysFor[eid]!]!;
}

const goalAtTheEnd = (direction: number): [x: number, y: number] => [direction > 0 ? PITCH_LENGTH : 0, GOAL_CENTRE];

export const goalAttackedBy = (world: Game, eid: number) => goalAtTheEnd(attackingDirectionOf(world, eid));

export const goalDefendedBy = (world: Game, eid: number) => goalAtTheEnd(-attackingDirectionOf(world, eid));

import { hasComponent } from "bitecs";
import { PITCH_LENGTH } from "../src/constants";
import { acrossTheShot, spreadRadius, type Point } from "../src/shooting";
import type { Game } from "../src/world";

const POINTS_ON_CIRCLE = 48;

export const percent = (chance: number) => `${Math.round(chance * 100)}%`;

export function circleAroundAim(grade: number, from: Point, aim: Point): Point[] {
  const radius = spreadRadius(grade, from, aim);
  const [acrossX, acrossY] = acrossTheShot(from, aim);
  return Array.from({ length: POINTS_ON_CIRCLE }, (_, i) => {
    const angle = (i / POINTS_ON_CIRCLE) * 2 * Math.PI;
    const across = radius * Math.cos(angle);
    return [aim[0] + acrossX * across, aim[1] + acrossY * across, aim[2] + radius * Math.sin(angle)];
  });
}

export function holdBallWhereItCrossed(world: Game, ball: number) {
  const { Position, Velocity, GoalLineCrossing } = world.components;
  if (!hasComponent(world, ball, GoalLineCrossing)) return;
  [Position.x[ball], Position.y[ball], Position.z[ball]] = [PITCH_LENGTH, GoalLineCrossing.y[ball]!, GoalLineCrossing.z[ball]!];
  [Velocity.x[ball], Velocity.y[ball], Velocity.z[ball]] = [0, 0, 0];
}

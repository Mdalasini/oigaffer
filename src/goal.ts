import { CROSSBAR_HEIGHT, GOAL_WIDTH, PITCH_WIDTH } from "./constants";

export const GOAL_CENTRE = PITCH_WIDTH / 2;

export function isGoal(y: number, z: number): boolean {
  return Math.abs(y - GOAL_CENTRE) < GOAL_WIDTH / 2 && z < CROSSBAR_HEIGHT;
}

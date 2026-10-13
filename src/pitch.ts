import { vec } from "./vec";

// Metres. x runs along the pitch; the side in this sandbox attacks the goal at x = PITCH_LENGTH.
export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;
export const GOAL_HALF_WIDTH = 3.66;
export const GOAL_HEIGHT = 2.44;
export const GOAL_CENTRE = vec(PITCH_LENGTH, PITCH_WIDTH / 2);
export const NEAR_POST = vec(PITCH_LENGTH, PITCH_WIDTH / 2 - GOAL_HALF_WIDTH);
export const FAR_POST = vec(PITCH_LENGTH, PITCH_WIDTH / 2 + GOAL_HALF_WIDTH);

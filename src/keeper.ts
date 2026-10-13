import { KEEPER_DIVE_SPEED, KEEPER_HIGHEST_REACH, KEEPER_REACH, KEEPER_REACTION_TIME } from "./constants";
import type { Mover } from "./interception";

export type Keeper = [x: number, y: number];

export const KEEPER: Mover = { reach: KEEPER_REACH, speed: KEEPER_DIVE_SPEED, highest: KEEPER_HIGHEST_REACH, reaction: KEEPER_REACTION_TIME };

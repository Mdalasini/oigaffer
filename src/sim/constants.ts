// World space is metres, z-up. The origin is the centre spot; +x runs towards
// the goal we attack, +y towards the left touchline as seen by the attacker.
// The pitch's size and markings vary by match (see `pitch`); the goals don't.
export const GOAL_HALF_WIDTH = 7.32 / 2
export const GOAL_HEIGHT = 2.44
export const GOAL_DEPTH = 2
export const POST_WIDTH = 0.12

export const GRAVITY = 9.81
export const BALL_RADIUS = 0.11
export const BALL_RESTITUTION = 0.55
/** Rolling resistance: a constant deceleration plus drag proportional to speed. */
export const BALL_ROLL_DECEL = 0.8
export const BALL_ROLL_DRAG = 0.3

export const FIXED_DT = 1 / 120

/** Outfielders a side, besides the keeper, unless a match asks for another number. */
export const OUTFIELDERS_PER_SIDE = 4

export const MIN_GRADE = 1
export const MAX_GRADE = 20

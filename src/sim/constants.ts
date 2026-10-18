// World space is metres, z-up. The origin is the centre spot; +x runs towards
// the goal we attack, +y towards the left touchline as seen by the attacker.
// A small-sided pitch for two outfielders and a keeper a side: 50 m by 32 m,
// about 270 m² a player (11v11 has about 320), with full-size goals and
// markings scaled down to fit.
export const PITCH_HALF_LENGTH = 25
export const PITCH_HALF_WIDTH = 16

export const GOAL_X = PITCH_HALF_LENGTH
export const GOAL_HALF_WIDTH = 7.32 / 2
export const GOAL_HEIGHT = 2.44
export const GOAL_DEPTH = 2
export const POST_WIDTH = 0.12

export const PENALTY_AREA_DEPTH = 10
export const PENALTY_AREA_HALF_WIDTH = 10
export const GOAL_AREA_DEPTH = 3
export const GOAL_AREA_HALF_WIDTH = 5.5
export const PENALTY_SPOT_DISTANCE = 8
export const CIRCLE_RADIUS = 6

export const GRAVITY = 9.81
export const BALL_RADIUS = 0.11
export const BALL_RESTITUTION = 0.55
/** Rolling resistance: a constant deceleration plus drag proportional to speed. */
export const BALL_ROLL_DECEL = 0.8
export const BALL_ROLL_DRAG = 0.3

export const FIXED_DT = 1 / 120

/** Outfielders a side, besides the keeper, unless a match asks for another number. */
export const OUTFIELDERS_PER_SIDE = 2

export const MIN_GRADE = 1
export const MAX_GRADE = 20

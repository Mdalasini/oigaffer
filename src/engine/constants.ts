// Tuning knobs for the event engine. One tick is one second, distances are metres.
// Calibrated with `bun run calibrate` so results line up with the Poisson engine
// (about 2.8 goals a game, favourites winning ~55%).

export const MATCH_SECONDS = 90 * 60;
export const HALF_TIME = 45 * 60;

// Movement (metres per tick)
export const MOVE_SPEED = 6;
export const PRESS_SPEED = 7;
export const KEEPER_SPEED = 5;
export const CONTROL_RADIUS = 1.5;
// Ticks between gaining the ball and being able to act with it (taking a touch)
export const CONTROL_TICKS = 3;
export const KEEPER_HOLD_TICKS = 6;
// Pressers close down to this distance rather than standing on the carrier
export const PRESS_STAND_OFF = 1.5;
// A defender only leaves their zone to press when the ball is this close to their anchor
export const PRESS_TRIGGER = 30;

// Team shape: how far the formation slides with the ball
export const SHIFT_X = 0.6;
export const SHIFT_Y = 0.35;
export const ATTACK_PUSH = 10;
export const DEFEND_DROP = 3;
export const KEEPER_MAX_ADVANCE = 6;
export const KEEPER_BOX = 16.5;

// Valuation: worth of having the ball somewhere, in expected-goal units
export const POSSESSION_VALUE = 0.015;
export const PROGRESS_VALUE = 0.01; // extra for having the ball at the opponent's end vs your own
export const THREAT_SCALE = 0.4;
export const XG_MAX = 1.0;
export const XG_DECAY = 11.5;
export const DECISION_TEMPERATURE = 0.003;

// Passing
export const PASS_MAX_DISTANCE = 45;
export const KEEPER_PASS_MAX_DISTANCE = 35;
export const PASS_BASE = 0.99;
export const PASS_SKILL = 0.003; // accuracy per point of passing
export const PASS_DISTANCE_PENALTY = 0.004;
export const PRESSURE_RANGE = 2.5;
export const PRESSURE_PASS_FACTOR = 0.9;
export const INTERCEPT_MAX = 0.4;
export const INTERCEPT_FALLOFF = 1.5;
// The first few metres of a pass are covered by pressure, not interception
export const PASS_CLEAR_START = 2;

// Shooting
export const SHOT_PRESSURE_FACTOR = 0.6;
export const SHOT_SKILL = 0.02; // xG multiplier per point of shooting away from 10
export const KEEPER_SKILL = 0.01; // goal chance multiplier per point of goalkeeping away from 10
export const BLOCK_RANGE = 1;
export const BLOCK_CHANCE = 0.35;
export const ON_TARGET_BASE = 0.25;
export const ON_TARGET_SKILL = 0.008;
export const KEEPER_HOLD = 0.55;

// Dribbling
export const DRIBBLE_DISTANCE = 5;
export const DRIBBLE_CONTEST_RANGE = 3;
export const DRIBBLE_BASE = 0.5;
export const DRIBBLE_SKILL = 0.01;
export const DRIBBLE_FREE = 0.95;

// Clearances: a won loose ball is worth less than controlled possession
export const LOOSE_BALL_DISCOUNT = 0.5;
export const CLEAR_DISTANCE = 40;
export const KEEPER_KICK_DISTANCE = 50;

// Tackling
export const TACKLE_RANGE = 2;
export const TACKLE_ATTEMPT = 0.1;
export const TACKLE_BASE = 0.35;
export const TACKLE_SKILL = 0.01;
export const TACKLE_COOLDOWN = 3;

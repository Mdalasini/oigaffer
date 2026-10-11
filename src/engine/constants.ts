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

// Mentality, per step from balanced (-2 … +2)
export const MENTALITY_PUSH = 2; // metres players push up (or hold back) when their team has the ball
export const MENTALITY_RISK = 0.3; // how much more (or less) gains are weighed against losses

// How often managers look at the game, and the pause after a goal
export const MANAGER_INTERVAL = 5 * 60;

// Team shape: how far the formation slides with the ball
export const SHIFT_X = 0.6;
export const SHIFT_Y = 0.35;
export const ATTACK_PUSH = 10;
export const DEFEND_DROP = 3;
export const KEEPER_MAX_ADVANCE = 6;
export const KEEPER_BOX = 16.5;

// Marking: defenders pick up attackers near their zone and stand goal-side of them
export const MARK_RANGE = 12; // how far from their anchor a defender will pick someone up
export const MARK_DISTANCE = 1.5; // how tight they stand
export const MARK_HALF_MARGIN = 10; // attackers this far into the defending half or deeper get marked
export const COVER_DROP = 3; // spare defenders with nobody to mark drop this far behind the line

// Valuation: worth of having the ball somewhere, in expected-goal units
export const POSSESSION_VALUE = 0.015;
export const PROGRESS_VALUE = 0.01; // extra for having the ball at the opponent's end vs your own
export const THREAT_SCALE = 0.6;
export const XG_MAX = 0.85;
export const XG_DECAY = 7;
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
export const DRIBBLE_DISTANCE = 5; // taking someone on
export const CARRY_DISTANCE = 7; // running into open space
export const DRIBBLE_CONTEST_RANGE = 3;
export const DRIBBLE_BASE = 0.5;
export const DRIBBLE_SKILL = 0.01;
export const DRIBBLE_FREE = 0.95;

// Through balls: played into space ahead of a runner
export const THROUGH_BALL_MAX_DISTANCE = 60; // long balls over the top from deep
export const THROUGH_BALL_LEADS = [10, 20]; // metres ahead of the runner: short, and into the space behind a high line
export const RUN_SPEED = 8; // the runner is already moving, so gets there a bit quicker
export const RACE_SHARPNESS = 1.5; // how decisively a one-second head start wins the race

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

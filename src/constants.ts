// Every tuning number lives here, with its unit.

export const DT = 0.05; // seconds per simulation step

// ---------- Ball ----------
export const GRAVITY = 9.81; // m/s²
export const AIR_DRAG = 0.013; // 1/m: deceleration = AIR_DRAG × speed², for a size-5 ball
export const ROLL_DECEL = 1.0; // m/s²: rolling resistance on grass, on top of drag
export const BOUNCE_RESTITUTION = 0.55; // share of vertical speed kept on a bounce
export const BOUNCE_FRICTION = 0.8; // share of horizontal speed kept on a bounce
export const BOUNCE_MIN_SPEED = 1; // m/s: a slower landing stops bouncing and rolls

// ---------- Player movement ----------
// Attributes run 1–20 with 10 as an average professional.
export const TOP_SPEED = 8.5; // m/s at pace 10
export const TOP_SPEED_PER_PACE = 0.1; // m/s per pace point above or below 10
// Acceleration is a burst from standing that fades towards top speed
export const ACCEL = 8; // m/s² from standing at acceleration 10
export const ACCEL_PER_POINT = 0.25; // m/s² per acceleration point
export const ACCEL_AT_TOP_SPEED = 0.3; // share of the burst left at top speed, for changing direction
export const BRAKE = 6; // m/s²: stopping is quicker than starting
export const BACKPEDAL_SPEED = 2.5; // m/s: fastest movement sideways or backwards from facing
export const ACCEL_SIDEWAYS = 0.3; // share of acceleration available sideways or backwards from facing
export const TURN_RATE_STILL = 6; // rad/s: turning on the spot, half a turn in about 0.5 s
export const TURN_RATE_SPRINT = 3; // rad/s: turning at top speed

// ---------- Touching the ball ----------
export const REACH = 0.8; // m from a player's centre to the ball's for a touch
export const CONTACT_HEIGHT = 0.5; // m: highest ball a player can play with their feet
export const TOUCH_COOLDOWN = 0.3; // s between touches: resetting the feet
export const BALL_FRONT_ANGLE = 1.75; // rad (100°) either side of facing: the ball must be in front to play it
export const PREDICT_STEP = 0.1; // s between samples when predicting where the ball will be
export const PREDICT_HORIZON = 5; // s ahead the prediction looks

// First touch: a pass or loose ball moving quicker than this has to be controlled
export const CONTROL_SPEED = 4; // m/s
export const CONTROL_ERROR_BEST = 0.1; // rad: direction error of a control at firstTouch 20
export const CONTROL_ERROR_WORST = 0.5; // rad: at firstTouch 1
export const CONTROL_HEAVY_BEST = 0.05; // share of the incoming speed a control fails to kill, firstTouch 20
export const CONTROL_HEAVY_WORST = 0.3; // at firstTouch 1

// Dribbling: the player pushes the ball ahead and runs onto it
export const DRIBBLE_TOP_SPEED = 0.9; // share of top speed with the ball
export const DRIBBLE_TOUCH_BASE = 1.8; // m/s: a touch from standing
export const DRIBBLE_TOUCH_GAIN = 1.15; // ball speed per m/s of the player's speed: the ball runs ahead of them
export const DRIBBLE_SPEED_UP = 2; // m/s: each touch is weighted for running this much faster, up to carrying speed
export const TOUCH_ROOM = 1.5; // m: a touch stops at least this far short of the lines
export const MAX_TOUCH_TURN = 1.3; // rad (75°): sharpest a touch can turn from where they face
export const TURN_TOUCH_SOFTEN = 0.6; // a turning touch loses this share of its speed at MAX_TOUCH_TURN
export const DRIBBLE_ERROR_BEST = 0.04; // rad: direction error of a touch at dribbling 20, standing
export const DRIBBLE_ERROR_WORST = 0.2; // rad: at dribbling 1
export const DRIBBLE_SPEED_ERROR = 0.1; // share: spread of a touch's weight

// Shooting
export const SHOOT_CONFIDENCE = 0.95; // shoot once the chance of hitting the target is at least this
export const SHOT_MAX_ANGLE = 1.05; // rad (60°): furthest from their facing a player can strike
export const SHOT_SPEED = 22; // m/s horizontal at shooting 10
export const SHOT_SPEED_PER_POINT = 0.5; // m/s per shooting point
export const SHOT_AIM_HEIGHT = 0.5; // m: where a shot is aimed to cross the line
export const SHOT_ERROR_BEST = 0.03; // rad: direction error at shooting 20, standing, square on, ball still
export const SHOT_ERROR_WORST = 0.11; // rad: at shooting 1
export const SHOT_RUNNING_ERROR = 0.6; // extra error share at top speed
export const SHOT_ANGLE_ERROR = 0.5; // extra error share striking SHOT_MAX_ANGLE across the body
export const SHOT_BALL_ERROR = 0.03; // extra error share per m/s the ball moves relative to the player
export const SHOT_LIFT_ERROR = 0.5; // vertical speed error per m/s of shot speed per radian of direction error

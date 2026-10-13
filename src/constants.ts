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

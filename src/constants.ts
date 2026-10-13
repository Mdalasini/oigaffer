// Every tuning number lives here, with its unit.

export const DT = 0.05; // seconds per simulation step

// ---------- Ball ----------
export const GRAVITY = 9.81; // m/s²
export const AIR_DRAG = 0.013; // 1/m: deceleration = AIR_DRAG × speed², for a size-5 ball
export const ROLL_DECEL = 1.0; // m/s²: rolling resistance on grass, on top of drag
export const BOUNCE_RESTITUTION = 0.55; // share of vertical speed kept on a bounce
export const BOUNCE_FRICTION = 0.8; // share of horizontal speed kept on a bounce
export const BOUNCE_MIN_SPEED = 1; // m/s: a slower landing stops bouncing and rolls

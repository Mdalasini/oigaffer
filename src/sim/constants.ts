export const TICK_RATE = 30
export const DT = 1 / TICK_RATE

export const GRAVITY = 9.81
export const BALL_RADIUS = 0.11
/** Quadratic air drag coefficient (1/m) for a size-5 ball. */
export const AIR_DRAG = 0.013
/** Rolling resistance on grass: constant deceleration (m/s²) plus linear drag (1/s). */
export const ROLL_DECEL = 1.2
export const ROLL_DRAG = 0.25
export const BOUNCE_RESTITUTION = 0.55
export const BOUNCE_FRICTION = 0.8
/** Below this downward speed a landing ball stops bouncing and rolls. */
export const BOUNCE_SETTLE = 1.2

export const PLAYER_RADIUS = 0.35
/** Distance from a player's centre at which they can play the ball with their feet. */
export const FOOT_REACH = 0.75
/** Highest ball a player can play with feet or chest. */
export const CONTROL_HEIGHT = 1.4
/** An owner whose ball strays further than this has lost it. */
export const LOSE_DISTANCE = 2.5

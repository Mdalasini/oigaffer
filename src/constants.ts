export const DT = 1 / 60; // seconds per simulation step

export const PITCH_LENGTH = 105; // m
export const PITCH_WIDTH = 68; // m

export const TOP_SPEED = 8; // m/s
export const ACCEL = 4; // m/s²
export const BRAKE = 6; // m/s²: stopping is quicker than starting
export const ARRIVED = 0.05; // m: close enough to call it there

export const ROLL_DECEL = 1; // m/s²: a rolling ball slows on the grass
export const REACH = 0.6; // m: how close a player must be to touch the ball
export const TOUCH_AHEAD = 1; // m/s: a dribbling touch sends the ball this much faster than the player
export const TOUCH_INTERVAL = 0.3; // s: a dribbler touches the ball at most this often, about every other stride
export const DRIBBLE_SPEED = 7; // m/s: fastest a touch sends the ball, so the dribbler (TOP_SPEED) can always catch it
export const DRIBBLE_BRAKE = 3; // m/s²: a dribbler slows down more gently than they can stop without the ball
export const BEHIND_BALL = 0.3; // m: a dribbler runs to this far behind the ball
export const DRIBBLED = 0.2; // m: this close to where it's going, the dribbler stops the ball

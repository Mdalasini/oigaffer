export const TIME_STEP = 1 / 60;

export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;

export const TOP_SPEED = 8;
export const SIDEWAYS_SPEED = 2.5;
export const ACCELERATION = 4;
export const BRAKING = 6;
export const TURN_RATE = 6;
export const STANDING_SPEED = 0.5;
export const ARRIVAL_DISTANCE = 0.05;

export const BALL_ROLLING_DECELERATION = 1;

export const TOUCH_REACH = 0.6;
export const TOUCH_INTERVAL = 0.3;
export const MAX_TOUCH_SPEED_AWAY_FROM_PLAYER = 1;
export const MAX_DRIBBLE_TOUCH_SPEED = 7;
export const DRIBBLE_BRAKING = 3;
export const DISTANCE_BEHIND_BALL = 0.3;
export const DRIBBLE_STOP_DISTANCE = 0.2;

export const GRAVITY = 9.81;
export const BALL_BOUNCE_RESTITUTION = 0.6;
export const SETTLING_SPEED = 1;

export const GOAL_WIDTH = 7.32;
export const CROSSBAR_HEIGHT = 2.44;

export const BALL_RADIUS = 0.11;
export const LOWEST_BOOT_CONTACT = 0.03;
export const MAX_RELEASE_ANGLE = Math.asin((BALL_RADIUS - LOWEST_BOOT_CONTACT) / BALL_RADIUS);
export const WEAKEST_STRIKE_SPEED = 22;
export const STRONGEST_STRIKE_SPEED = 32;
export const WORST_GRADE = 1;
export const BEST_GRADE = 20;
export const AVERAGE_GRADE = 10;

export const WORST_SHOOTING_GRADE = WORST_GRADE;
export const BEST_SHOOTING_GRADE = BEST_GRADE;
export const WORST_SHOOTING_SPREAD = 0.08;
export const BEST_SHOOTING_SPREAD = 0.01;
export const AVERAGE_SHOOTING_GRADE = AVERAGE_GRADE;

export const KEEPER_REACTION_TIME = 0.25;
export const KEEPER_DIVE_SPEED = 5;
export const KEEPER_REACH = 1;
export const KEEPER_HIGHEST_REACH = 2.5;

export const TACKLE_REACH = 1;
export const EVEN_TACKLE_WIN_CHANCE = 0.5;
export const LOPSIDED_TACKLE_WIN_CHANCE = 0.9;
export const TACKLE_RECOVERY_TIME = 1;
export const TACKLE_CLEARANCE_SPEED = 6;
export const GOAL_SIDE_DISTANCE = 0.5;
export const BLOCKING_REACH = 0.5;
export const HIGHEST_BLOCK = 1.8;
export const PASSING_GAP = 1.5;
export const SHARPEST_TAKE_ON = Math.PI / 6;

export const PASS_ARRIVAL_SPEED = 8;
export const HARDEST_PASS = 20;
export const DEFENDER_REACTION_TIME = 0.25;
export const INTERCEPTING_SPEED = 6;
export const SUPPORT_SPACING = 4;
export const SUPPORT_FURTHEST_BEHIND = 8;
export const SUPPORT_FURTHEST_AHEAD = 12;
export const SUPPORT_WIDEST = 12;
export const SUPPORT_SWITCHING_GAIN = 0.05;
export const SUPPORT_RETHINK_INTERVAL = 0.25;

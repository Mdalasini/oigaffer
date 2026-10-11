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
export const MENTALITY_RISK = 0.2; // how much more (or less) gains are weighed against losses
export const MENTALITY_DIRECT = 0.3; // defensive teams are happier to hit it long and give up possession upfield
export const MENTALITY_WIDTH = 0.4; // share of the extra in-possession width added (or removed) per step

// How often managers look at the game, and the pause after a goal
export const MANAGER_INTERVAL = 5 * 60;

// Team shape: how far the formation slides with the ball
export const SHIFT_X = 0.6;
export const SHIFT_Y = 0.35;
export const ATTACK_PUSH = 10;
export const DEFEND_DROP = 3;
// Teams stretch the pitch with the ball and squeeze it without (multiplies distance from the centre line)
export const ATTACK_WIDTH = 1.45;
export const DEFEND_WIDTH = 0.9;
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
export const XG_MAX = 0.87;
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
export const SHOT_SKILL = 0.012; // xG multiplier per point of shooting away from 10
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
export const DRIBBLE_SKILL = 0.004;
export const DRIBBLE_FREE = 0.95;

// Through balls: played into space ahead of a runner
export const THROUGH_BALL_MAX_DISTANCE = 60; // long balls over the top from deep
export const THROUGH_BALL_LEADS = [10, 20]; // metres ahead of the runner: short, and into the space behind a high line
export const THROUGH_BALL_DEPTH = 100; // furthest a through ball is aimed (team-frame x); beyond that the keeper takes it
export const RUN_SPEED = 8; // the runner is already moving, so gets there a bit quicker
export const RACE_SHARPNESS = 1.5; // how decisively a one-second head start wins the race

// Clearances: a won loose ball is worth less than controlled possession
export const LOOSE_BALL_DISCOUNT = 0.5;
export const CLEAR_DISTANCE = 40;
export const CLEAR_OUTWARD = 0.6; // wide clearances are angled towards the touchline
export const CLEAR_MAX_DEPTH = 90; // team-frame x: a clearance is hit into the opponent's half, not over their goal line
export const KEEPER_KICK_DISTANCE = 50;

// Tackling
export const TACKLE_RANGE = 2;
export const TACKLE_ATTEMPT = 0.1;
export const TACKLE_BASE = 0.35;
export const TACKLE_SKILL = 0.004;
export const TACKLE_COOLDOWN = 3;
export const TACKLE_LOOSE = 0.35; // won tackles that poke the ball away rather than come away with it
export const TACKLE_LOOSE_DISTANCE: [number, number] = [2, 8];

// ---------- Rules, restarts and the referee ----------

// Pitch markings (metres)
export const GOAL_AREA_DEPTH = 5.5; // metres
export const BOX_DEPTH = 16.5;
export const BOX_HALF_WIDTH = 20.16;
export const PENALTY_SPOT = 11;
export const WALL_DISTANCE = 9.15; // opponents stand this far from a free kick or corner
export const THROW_IN_DISTANCE = 2;

// Dead-ball time before a restart is taken (ticks). The clock keeps running.
export const SETUP_TICKS = { throw_in: 6, goal_kick: 10, corner: 18, free_kick: 10, penalty: 40, kickoff: 1 } as const;
export const DANGEROUS_FREE_KICK_TICKS = 25; // lining up a wall in shooting range
export const GOAL_CELEBRATION_TICKS = 40;

// Throw-ins only reach so far
export const THROW_MAX_DISTANCE = 22;

// Crossing: from wide in the final third into the box
export const CROSS_ZONE_X = 68; // team-frame x beyond which a wide player can cross
export const CROSS_ZONE_WIDTH = 12; // how far from the centre line counts as wide
export const CROSS_BASE = 0.7; // chance an average delivery finds its area
export const CROSS_SKILL = 0.01;
export const KEEPER_CLAIM = 0.25; // average keeper claiming a good cross
export const KEEPER_CLAIM_SKILL = 0.015;
export const AERIAL_BASE = 0.4; // attacker winning a contested header
export const AERIAL_SKILL = 0.01;
export const AERIAL_FREE = 0.8; // nobody near the target
export const AERIAL_CONTEST_RANGE = 3;
export const AERIAL_CROWD_RANGE = 7; // other defenders this close to the target crowd them out
export const AERIAL_CROWD = 0.12; // each one takes this share off the attacker's chance
export const HEADER_XG_FACTOR = 0.55; // headers go in less often than shots from the same spot

// Direct free kicks and penalties
export const FREE_KICK_SHOT_RANGE = 32;
export const FREE_KICK_XG_MAX = 0.12;
export const FREE_KICK_XG_DECAY = 9;
export const PENALTY_XG = 0.76;
export const PENALTY_SKILL = 0.01; // per point of shooting minus goalkeeping

// Ball out of play
export const PARRY_FOR_CORNER = 0.35; // saves pushed behind
export const BLOCK_FOR_CORNER = 0.3; // blocked shots deflected behind
export const HEADED_BEHIND = 0.3; // crosses headed out for a corner
export const CROSS_BLOCK_RANGE = 2.5; // a defender this close to the crosser can get in the way
export const CROSS_BLOCK = 0.3;
export const CROSS_BLOCK_FOR_CORNER = 0.6;

// Fouls and cards (per foul unless noted)
export const FOUL_ON_FAILED_TACKLE = 0.25;
export const FOUL_TACKLING_SKILL = 0.04; // fewer fouls per point of tackling above 10
export const TACTICAL_FOUL = 0.12; // pulling back someone who has just beaten you
export const BOX_FOUL_FACTOR = 0.12; // defenders (and refs) are far more careful in the box
export const ADVANTAGE_CHANCE = 0.5; // in the attacking half, the ref often lets play go on
export const YELLOW_CHANCE = 0.12;
export const TACTICAL_YELLOW_CHANCE = 0.5;
export const STRAIGHT_RED_CHANCE = 0.004;
export const BOOKED_CAUTION = 0.5; // booked players foul less, and refs think twice about a second yellow
export const DOGSO_RANGE = 25; // a last-man foul this close to goal stops a clear chance
export const DOGSO_WIDTH = 12; // ...if the attacker is central enough to have a clear sight of goal
export const INJURY_CHANCE = 0.012;
export const REFEREE_STRICTNESS: [number, number] = [0.75, 1.3];

// Offside: the assistant flags anyone level or better only past a small tolerance,
// and passers misjudge a run that's only just off
export const OFFSIDE_TOLERANCE = 0.3;
export const OFFSIDE_PERCEPTION = 0.8;
export const OFFSIDE_GAMBLE = 2; // how far a forward will cheat past the line hunting space
export const OFFSIDE_GAMBLE_CHANCE = 0.2; // per tick

// Stoppage time (seconds added per stoppage)
export const ADDED = { goal: 45, substitution: 25, card: 20, injury: 60, penalty: 30 } as const;
export const MIN_ADDED_MINUTES = [1, 2] as const; // per half

// Fatigue: energy runs from 1 (fresh) down as players cover ground
export const FATIGUE_PER_METRE = 3e-5; // for stamina 10
export const FATIGUE_STAMINA = 0.05; // how much each point of stamina slows tiring
export const FATIGUE_EFFECT = 0.3; // attributes at zero energy are this much lower
export const FATIGUE_SPEED = 0.25; // and speed this much lower
export const HALF_TIME_RECOVERY = 0.05;

// Substitutions
export const MAX_SUBS = 5;

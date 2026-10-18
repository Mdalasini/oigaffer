import { MAX_GRADE, MIN_GRADE } from './constants'

export function clampGrade(grade: number): number {
  return Math.min(MAX_GRADE, Math.max(MIN_GRADE, Math.round(grade)))
}

/** 0 for the worst grade, 1 for the best. */
export function gradeT(grade: number): number {
  return (clampGrade(grade) - MIN_GRADE) / (MAX_GRADE - MIN_GRADE)
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Standard deviation (rad) of how far off line a clean, unhurried shot goes:
 * about 10° for the worst finisher and 4° for the best, so the miss grows
 * with distance, as it does for a real shot. Unblocked shots in real matches
 * are on target a little under half the time.
 */
export function shotAngleError(shooting: number): number {
  return lerp(0.18, 0.07, gradeT(shooting))
}

/** Seconds a keeper stands still after the ball is struck. */
export function reactionDelay(reaction: number): number {
  return lerp(0.4, 0.08, gradeT(reaction))
}

/**
 * Chance (0–1) that a keeper with `handling` holds a shot that comes straight
 * at them, rather than parrying it. Stretching for it makes holding harder.
 */
export function catchChance(handling: number): number {
  return lerp(0.3, 0.9, gradeT(handling))
}

/** Standard deviation (rad) of where a touch goes versus where it was meant to. */
export function touchAngleError(dribbling: number): number {
  return lerp(0.2, 0.03, gradeT(dribbling))
}

/** Relative standard deviation of how hard a touch is struck. */
export function touchWeightError(dribbling: number): number {
  return lerp(0.2, 0.04, gradeT(dribbling))
}

/**
 * Fastest a player can run while keeping the ball close with small touches
 * (m/s): a share of their top speed that grows with dribbling.
 */
export function closeControlSpeed(pace: number, dribbling: number): number {
  return topSpeed(pace) * lerp(0.55, 0.8, gradeT(dribbling))
}

/**
 * How far behind (s) a defender's read of the carrier's movement runs.
 * Jockeying keeps it short; running flat out at least doubles it.
 */
export function readLag(marking: number, running: boolean): number {
  return lerp(0.3, 0.08, gradeT(marking)) * (running ? 2.5 : 1)
}

/**
 * Base chance (0–1) that a tackle by a defender with `tackling` gets the
 * ball off a carrier with `dribbling`, before reach and shielding.
 */
export function tackleSkill(tackling: number, dribbling: number): number {
  return Math.min(0.9, Math.max(0.1, 0.42 + (clampGrade(tackling) - clampGrade(dribbling)) * 0.025))
}

/** Chance (0–1) that a barge by a player with `strength` knocks one with `opponentStrength` off the ball. */
export function bargeWinChance(strength: number, opponentStrength: number): number {
  return Math.min(0.9, Math.max(0.1, 0.5 + (clampGrade(strength) - clampGrade(opponentStrength)) * 0.04))
}

/** Flat-out running speed (m/s). */
export function topSpeed(pace: number): number {
  return lerp(6.8, 9.4, gradeT(pace))
}

/** Forward acceleration (m/s²); braking is quicker than this. */
export function accelerationRate(acceleration: number): number {
  return lerp(3.2, 6.4, gradeT(acceleration))
}

/** Turn rate (rad/s) when standing still; it falls away with speed. */
export function turnRate(agility: number): number {
  return lerp(5, 10, gradeT(agility))
}

/** Top speed (m/s) when sidestepping or backpedalling. */
export function sideStepSpeed(agility: number): number {
  return lerp(2.4, 3.6, gradeT(agility))
}

/** Standard deviation (rad) of a pass's direction from where it was aimed, before distance and pressure. */
export function passAngleError(passing: number): number {
  return lerp(0.09, 0.015, gradeT(passing))
}

/** Relative standard deviation of how hard a pass is struck. */
export function passWeightError(passing: number): number {
  return lerp(0.14, 0.03, gradeT(passing))
}

/**
 * The fastest a ball can come at a player (m/s, relative to them) and still
 * be cushioned dead. Anything quicker bounces off further.
 */
export function cleanTakeSpeed(firstTouch: number): number {
  return lerp(6, 14, gradeT(firstTouch))
}

/** Standard deviation (rad) of where a first touch sends the ball from where it was meant to go. */
export function firstTouchError(firstTouch: number): number {
  return lerp(0.5, 0.08, gradeT(firstTouch))
}

/** Chance, each time they look, that a player spots a teammate outside their field of view. */
export function spotChance(vision: number): number {
  return lerp(0.15, 0.85, gradeT(vision))
}

/** Relative standard deviation of the error in how a player rates their options. */
export function judgementError(decisions: number): number {
  return lerp(0.4, 0.05, gradeT(decisions))
}

/** Standard deviation (m) of how far a passer misjudges a teammate's position against the offside line. */
export function offsideMisjudgement(decisions: number): number {
  return lerp(1, 0.2, gradeT(decisions))
}

/** Seconds a marker takes to pick up a run made behind their back. */
export function blindSideDelay(positioning: number): number {
  return lerp(0.8, 0.15, gradeT(positioning))
}

/** Seconds between choosing a pass and striking it: the look, the set and the backswing. */
export function passWindup(passing: number): number {
  return lerp(0.28, 0.14, gradeT(passing))
}

/** Standard deviation (s) of how far a runner's burst is from the moment a through ball is struck. */
export function runTimingError(offTheBall: number): number {
  return lerp(0.35, 0.06, gradeT(offTheBall))
}

/** Chance a back line steps up together to catch a runner offside as a pass is shaped to be played. */
export function trapChance(positioning: number): number {
  return lerp(0.1, 0.6, gradeT(positioning))
}

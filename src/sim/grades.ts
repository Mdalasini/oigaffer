import { MAX_GRADE, MIN_GRADE } from './constants'

export function clampGrade(grade: number): number {
  return Math.min(MAX_GRADE, Math.max(MIN_GRADE, Math.round(grade)))
}

/** 0 for the worst grade, 1 for the best. */
function gradeT(grade: number): number {
  return (clampGrade(grade) - MIN_GRADE) / (MAX_GRADE - MIN_GRADE)
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Radius (m) of the circle around the aim point that a shot can land in. */
export function shotSpreadRadius(shooting: number): number {
  return lerp(2.4, 0.35, gradeT(shooting))
}

/** Seconds a keeper stands still after the ball is struck. */
export function reactionDelay(reaction: number): number {
  return lerp(0.4, 0.08, gradeT(reaction))
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

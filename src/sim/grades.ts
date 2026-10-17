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

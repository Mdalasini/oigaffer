/** Wraps an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2)
  if (a < 0) a += Math.PI * 2
  return a - Math.PI
}

/** Signed smallest rotation from `from` to `to`. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from)
}

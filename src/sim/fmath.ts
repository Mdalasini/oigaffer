// Deterministic math for the simulation.
//
// JS engines are free to implement Math.sin/cos/atan2/exp/pow differently in the
// last bits (V8 in the browser vs JavaScriptCore under bun). A flagged moment is
// re-simulated headlessly, so sim code must only use IEEE-exact operations:
// + - * / sqrt, floor/round/abs/min/max. These are built from those alone.

export const PI = 3.141592653589793
export const TAU = 6.283185307179586
export const HALF_PI = 1.5707963267948966
const LN2 = 0.6931471805599453
const SQRT3 = 1.7320508075688772
const TAN_PI_12 = 0.2679491924311227

/** Wraps an angle to [-PI, PI]. */
export function wrapAngle(a: number): number {
  return a - TAU * Math.round(a / TAU)
}

// Taylor series on [-PI/2, PI/2]; truncation error < 1e-9.
function sinCore(x: number): number {
  const x2 = x * x
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800)))))))
  )
}

export function sin(a: number): number {
  let x = wrapAngle(a)
  if (x > HALF_PI) x = PI - x
  else if (x < -HALF_PI) x = -PI - x
  return sinCore(x)
}

export function cos(a: number): number {
  return sin(a + HALF_PI)
}

// Series on [-tan(PI/12), tan(PI/12)]; truncation error < 1e-11.
function atanCore(t: number): number {
  const t2 = t * t
  let sum = 0
  for (let k = 17; k >= 3; k -= 2) {
    const sign = ((k - 1) / 2) % 2 === 0 ? 1 : -1
    sum = t2 * (sign / k + sum)
  }
  return t * (1 + sum)
}

export function atan(t: number): number {
  if (t < 0) return -atan(-t)
  if (t > 1) return HALF_PI - atan(1 / t)
  if (t > TAN_PI_12) return PI / 6 + atanCore((t * SQRT3 - 1) / (SQRT3 + t))
  return atanCore(t)
}

export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x)
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI
  if (y > 0) return HALF_PI
  if (y < 0) return -HALF_PI
  return 0
}

export function exp(x: number): number {
  if (x > 700) return Infinity
  if (x < -700) return 0
  const k = Math.round(x / LN2)
  const r = x - k * LN2
  let term = 1
  let sum = 1
  for (let i = 1; i <= 13; i++) {
    term *= r / i
    sum += term
  }
  let scale = 1
  const base = k < 0 ? 0.5 : 2
  for (let i = Math.abs(k); i > 0; i--) scale *= base
  return sum * scale
}

export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y)
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

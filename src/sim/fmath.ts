/**
 * The maths functions the sim uses, written out so every JavaScript engine
 * gets the same answer to the last bit. `Math.sin`, `Math.exp` and the like
 * are only approximately specified, and V8 (Chrome, Node) and JavaScriptCore
 * (Safari, Bun) round some results differently; a match replayed in another
 * engine would then drift from the one watched. Built from +, −, ×, ÷ and
 * `Math.sqrt`, which IEEE 754 fixes exactly, these play the same everywhere.
 *
 * The algorithms are FreeBSD's msun (fdlibm), as musl has them, so results are
 * within an ulp or so of the true value.
 */

/** √(x² + y²): plain arithmetic, as `Math.hypot`'s overflow guard differs between engines. */
export const hypot = (x: number, y: number) => Math.sqrt(x * x + y * y)

// --- sine and cosine ---

const PIO2_1 = 1.57079632673412561417e+0
const PIO2_2 = 6.07710050630396597660e-11
const PIO2_2T = 2.02226624879595063154e-21
const INV_PIO2 = 6.36619772367581382433e-1

const S1 = -1.66666666666666324348e-1
const S2 = 8.33333333332248946124e-3
const S3 = -1.98412698298579493134e-4
const S4 = 2.75573137070700676789e-6
const S5 = -2.50507602534068634195e-8
const S6 = 1.58969099521155010221e-10

const C1 = 4.16666666666666019037e-2
const C2 = -1.38888888888741095749e-3
const C3 = 2.48015872894767294178e-5
const C4 = -2.75573143513906633035e-7
const C5 = 2.08757232129817482790e-9
const C6 = -1.13596475577881948265e-11

/** sin(x + y) for |x + y| ≤ π/4, y the tail of x. */
function kernelSin(x: number, y: number): number {
  const z = x * x
  const w = z * z
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6)
  const v = z * x
  return x - ((z * (0.5 * y - v * r) - y) - v * S1)
}

/** cos(x + y) for |x + y| ≤ π/4, y the tail of x. */
function kernelCos(x: number, y: number): number {
  const z = x * x
  const w = z * z
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6))
  const hz = 0.5 * z
  const v = 1 - hz
  return v + (((1 - v) - hz) + (z * r - x * y))
}

/**
 * x reduced by the nearest multiple n of π/2, as a head and tail, with n mod
 * 4. Accurate for the angles a match deals in (well under a million radians).
 */
const reduced = { hi: 0, lo: 0, quadrant: 0 }
function reduce(x: number) {
  const n = Math.round(x * INV_PIO2)
  // Two rounds of Cody–Waite reduction: π/2 split into three parts, good to well past double precision.
  const t = x - n * PIO2_1
  let w = n * PIO2_2
  const r = t - w
  w = n * PIO2_2T - ((t - r) - w)
  reduced.hi = r - w
  reduced.lo = (r - reduced.hi) - w
  reduced.quadrant = ((n % 4) + 4) % 4
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return NaN
  if (Math.abs(x) < 7.4505805969238281e-9) return x
  reduce(x)
  const { hi, lo } = reduced
  switch (reduced.quadrant) {
    case 0: return kernelSin(hi, lo)
    case 1: return kernelCos(hi, lo)
    case 2: return -kernelSin(hi, lo)
    default: return -kernelCos(hi, lo)
  }
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN
  reduce(x)
  const { hi, lo } = reduced
  switch (reduced.quadrant) {
    case 0: return kernelCos(hi, lo)
    case 1: return -kernelSin(hi, lo)
    case 2: return -kernelCos(hi, lo)
    default: return kernelSin(hi, lo)
  }
}

export const tan = (x: number) => sin(x) / cos(x)

// --- arctangent ---

const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e+0]
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17]
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.65315727442169155270e-2, 1.62858201153657823623e-2,
]

export function atan(x: number): number {
  if (Number.isNaN(x)) return NaN
  const negative = x < 0
  let a = Math.abs(x)
  let id: number
  if (a >= 7.3786976294838206464e19) return negative ? -(ATAN_HI[3] + ATAN_LO[3]) : ATAN_HI[3] + ATAN_LO[3]
  if (a < 0.4375) {
    if (a < 3.7252902984e-9) return x
    id = -1
  } else if (a < 1.1875) {
    if (a < 0.6875) {
      id = 0
      a = (2 * a - 1) / (2 + a)
    } else {
      id = 1
      a = (a - 1) / (a + 1)
    }
  } else if (a < 2.4375) {
    id = 2
    a = (a - 1.5) / (1 + 1.5 * a)
  } else {
    id = 3
    a = -1 / a
  }
  const z = a * a
  const w = z * z
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))))
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))))
  if (id < 0) return negative ? -(a - a * (s1 + s2)) : a - a * (s1 + s2)
  const r = ATAN_HI[id] - ((a * (s1 + s2) - ATAN_LO[id]) - a)
  return negative ? -r : r
}

const PI = 3.1415926535897931160e+0
const PI_LO = 1.2246467991473531772e-16

/** The angle of (x, y) from the +x axis, in (−π, π]. */
export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN
  // The infinite cases have exact answers every engine agrees on.
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Math.atan2(y, x)
  const negY = y < 0 || Object.is(y, -0)
  const negX = x < 0 || Object.is(x, -0)
  if (y === 0) return negX ? (negY ? -PI : PI) : y
  if (x === 0) return negY ? -PI / 2 : PI / 2
  if (x === 1) return atan(y)
  const z = atan(Math.abs(y / x))
  if (!negX) return negY ? -z : z
  return negY ? (z - PI_LO) - PI : PI - (z - PI_LO)
}

// --- exponential and logarithm ---

const LN2_HI = 6.93147180369123816490e-1
const LN2_LO = 1.90821492927058770002e-10
const INV_LN2 = 1.44269504088896338700e+0
const P1 = 1.66666666666666019037e-1
const P2 = -2.77777777770155933842e-3
const P3 = 6.61375632143793436117e-5
const P4 = -1.65339022054652515390e-6
const P5 = 4.13813679705723846039e-8

const bits = new DataView(new ArrayBuffer(8))

/** 2^k exactly, for −1022 ≤ k ≤ 1023. */
function twoTo(k: number): number {
  bits.setUint32(0, (k + 1023) << 20)
  bits.setUint32(4, 0)
  return bits.getFloat64(0)
}

/** y × 2^k exactly (short of underflow), for any whole k. */
function scale(y: number, k: number): number {
  if (k > 1023) {
    y *= twoTo(1023)
    k -= 1023
    if (k > 1023) return y * Infinity
  } else if (k < -1022) {
    y *= twoTo(-1022) * twoTo(53)
    k += 1022 - 53
    if (k < -1022) {
      y *= twoTo(-1022) * twoTo(53)
      k += 1022 - 53
      if (k < -1022) k = -1022
    }
  }
  return y * twoTo(k)
}

export function exp(x: number): number {
  if (Number.isNaN(x)) return NaN
  if (x > 709.782712893383973096) return Infinity
  if (x < -745.13321910194110842) return 0
  let k = 0
  let hi = x
  let lo = 0
  const a = Math.abs(x)
  if (a > 0.5 * LN2_HI) {
    k = a >= 1.5 * LN2_HI ? Math.trunc(INV_LN2 * x + (x < 0 ? -0.5 : 0.5)) : x < 0 ? -1 : 1
    hi = x - k * LN2_HI
    lo = k * LN2_LO
    x = hi - lo
  } else if (a < 3.7252902984e-9) {
    return 1 + x
  }
  const xx = x * x
  const c = x - xx * (P1 + xx * (P2 + xx * (P3 + xx * (P4 + xx * P5))))
  const y = 1 + ((x * c) / (2 - c) - lo + hi)
  return k === 0 ? y : scale(y, k)
}

const LG1 = 6.666666666666735130e-1
const LG2 = 3.999999999940941908e-1
const LG3 = 2.857142874366239149e-1
const LG4 = 2.222219843214978396e-1
const LG5 = 1.818357216161805012e-1
const LG6 = 1.531383769920937332e-1
const LG7 = 1.479819860511658591e-1

/** The natural logarithm. */
export function log(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN
  if (x === 0) return -Infinity
  if (x === Infinity) return Infinity
  let k = 0
  // Subnormal: scale up into the normal range first.
  if (x < 2.2250738585072014e-308) {
    k -= 54
    x *= twoTo(54)
  }
  bits.setFloat64(0, x)
  let hx = bits.getUint32(0)
  hx += 0x3ff00000 - 0x3fe6a09e
  k += (hx >>> 20) - 0x3ff
  hx = (hx & 0x000fffff) + 0x3fe6a09e
  bits.setUint32(0, hx)
  x = bits.getFloat64(0)
  const f = x - 1
  const hfsq = 0.5 * f * f
  const s = f / (2 + f)
  const z = s * s
  const w = z * z
  const t1 = w * (LG2 + w * (LG4 + w * LG6))
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)))
  const r = t2 + t1
  return s * (hfsq + r) + k * LN2_LO - hfsq + f + k * LN2_HI
}

/** x^y for x > 0. */
export const pow = (x: number, y: number) => exp(y * log(x))

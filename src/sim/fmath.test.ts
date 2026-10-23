import { describe, expect, test } from 'bun:test'
import { atan2, cos, exp, sin, wrapAngle } from './fmath'

describe('fmath', () => {
  test('sin/cos match Math within 1e-8 across several turns', () => {
    for (let a = -20; a <= 20; a += 0.137) {
      expect(Math.abs(sin(a) - Math.sin(a))).toBeLessThan(1e-8)
      expect(Math.abs(cos(a) - Math.cos(a))).toBeLessThan(1e-8)
    }
  })

  test('atan2 matches Math in every quadrant and on the axes', () => {
    for (let a = -3.1; a <= 3.1; a += 0.05) {
      const x = Math.cos(a) * 3
      const y = Math.sin(a) * 3
      expect(Math.abs(atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-9)
    }
    expect(atan2(0, 1)).toBe(0)
    expect(atan2(1, 0)).toBeCloseTo(Math.PI / 2, 12)
    expect(atan2(-1, 0)).toBeCloseTo(-Math.PI / 2, 12)
    expect(atan2(0, -1)).toBeCloseTo(Math.PI, 12)
  })

  test('exp matches Math to relative 1e-12', () => {
    for (let x = -30; x <= 30; x += 0.71) {
      expect(Math.abs(exp(x) / Math.exp(x) - 1)).toBeLessThan(1e-12)
    }
  })

  test('wrapAngle lands in [-PI, PI]', () => {
    for (let a = -50; a <= 50; a += 0.9) {
      const w = wrapAngle(a)
      expect(w).toBeGreaterThanOrEqual(-Math.PI)
      expect(w).toBeLessThanOrEqual(Math.PI)
      expect(Math.abs(Math.sin(w) - Math.sin(a))).toBeLessThan(1e-9)
    }
  })
})

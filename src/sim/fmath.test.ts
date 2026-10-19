import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { atan, atan2, cos, exp, hypot, log, pow, sin, tan } from './fmath'
import { createRng } from './rng'

/** Within `ulps` units in the last place of `expected`. */
function close(actual: number, expected: number, ulps = 2) {
  if (Number.isNaN(expected)) return expect(actual).toBeNaN()
  const ulp = Math.max(Number.EPSILON * Math.abs(expected), Number.MIN_VALUE)
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(ulps * ulp + 1e-300)
}

describe('deterministic maths', () => {
  const rng = createRng(9)
  const samples = (scale: number) => Array.from({ length: 20000 }, () => (rng() * 2 - 1) * scale)

  test('agrees with Math to within an ulp or two', () => {
    for (const x of [...samples(1), ...samples(10), ...samples(1000), 0, -0, Math.PI, -Math.PI / 2, 1e-12]) {
      close(sin(x), Math.sin(x))
      close(cos(x), Math.cos(x))
      close(atan(x), Math.atan(x))
    }
    for (const x of [...samples(1), ...samples(5)]) close(tan(x), Math.tan(x), 4)
    for (const x of [...samples(1), ...samples(50), ...samples(700), 0, 1e-12, -1e-12]) close(exp(x), Math.exp(x))
    for (const x of [...samples(1), ...samples(1e6), 1e-310, 1, 2, Number.MAX_VALUE].map(Math.abs)) close(log(x), Math.log(x))
    for (const [y, x] of samples(50).map((y, i) => [y, samples(50)[i % 100]])) close(atan2(y, x), Math.atan2(y, x))
    for (const [y, x] of [[0, 1], [0, -1], [-0, -1], [1, 0], [-1, 0], [0, 0], [-0, 0], [0, -0], [3, 1], [-2, -5]]) {
      expect(atan2(y, x)).toBe(Math.atan2(y, x))
    }
    expect(hypot(3, 4)).toBe(5)
    close(pow(0.97, 2.5), Math.pow(0.97, 2.5), 8)
    expect(exp(1000)).toBe(Infinity)
    expect(exp(-1000)).toBe(0)
    expect(log(-1)).toBeNaN()
    expect(log(0)).toBe(-Infinity)
  })

  // The sim must use these, not the engine's own approximations, or a match
  // replayed in another engine (a flag from the browser, inspected in Bun)
  // drifts from the one watched.
  test('the sim never calls the engine’s approximate maths', () => {
    const banned = /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot)\b|[\w)\]]\s*\*\*\s*[\w(]/
    const offenders: string[] = []
    const visit = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) visit(path)
        else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'fmath.ts') {
          readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
            const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '')
            if (banned.test(code)) offenders.push(`${path}:${i + 1}: ${line.trim()}`)
          })
        }
      }
    }
    visit(import.meta.dir)
    expect(offenders).toEqual([])
  })
})

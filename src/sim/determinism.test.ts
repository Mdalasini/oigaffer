import { expect, test } from 'bun:test'
import { Glob } from 'bun'
import { createRng, next } from './rng'

// Sim code must replay identically under bun (JSC) and the browser (V8); see fmath.ts.
// Math is allow-listed to operations IEEE 754 defines exactly.
const EXACT_MATH = new Set(['abs', 'min', 'max', 'floor', 'ceil', 'round', 'trunc', 'sign', 'sqrt', 'fround', 'imul', 'clz32', 'PI'])
const FORBIDDEN = [/[\w)\]]\s*\*\*\s*[\w(-]/, /\bDate\b/, /\bperformance\b/, /\bMath\s*\[/, /\bMath\s*\)/, /[=,(]\s*Math\s*[;,)]/]

function violations(source: string): number[] {
  const bad: number[] = []
  source.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '')
    const members = [...code.matchAll(/\bMath\s*\.\s*(\w+)/g)].map((m) => m[1])
    if (members.some((name) => !EXACT_MATH.has(name)) || FORBIDDEN.some((re) => re.test(code))) bad.push(i + 1)
  })
  return bad
}

test('the guard rejects engine-dependent math, clocks and indirect Math access', () => {
  for (const src of ['Math.sin(a)', 'Math.asinh(x)', 'Math["sin"](x)', 'const M = Math;', 'x ** 2', 'Date.now()', 'performance.now()', 'Math.random()']) {
    expect(violations(src)).toEqual([1])
  }
  expect(violations('Math.sqrt(x) + Math.abs(y) // Math.sin is fine in comments')).toEqual([])
})

test('sim sources avoid engine-dependent math, randomness and clocks', async () => {
  const offenders: string[] = []
  for await (const file of new Glob('**/*.ts').scan(import.meta.dir)) {
    if (file.endsWith('.test.ts')) continue
    for (const line of violations(await Bun.file(`${import.meta.dir}/${file}`).text())) offenders.push(`${file}:${line}`)
  }
  expect(offenders).toEqual([])
})

test('rng sequence is fixed for a seed', () => {
  const r = createRng(42)
  const seq = [next(r), next(r), next(r)]
  const again = createRng(42)
  expect([next(again), next(again), next(again)]).toEqual(seq)
  expect(seq.every((v) => v >= 0 && v < 1)).toBe(true)
})

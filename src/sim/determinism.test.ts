import { expect, test } from 'bun:test'
import { Glob } from 'bun'
import { createRng, next } from './rng'

// Sim code must replay identically under bun (JSC) and the browser (V8); see fmath.ts.
const FORBIDDEN = [
  /Math\.(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot|sinh|cosh|tanh|random)\b/,
  /[\w)\]]\s*\*\*\s*[\w(-]/,
  /\bDate\.now\b|\bperformance\.now\b|\bnew Date\b/,
]

test('sim sources avoid engine-dependent math, randomness and clocks', async () => {
  const offenders: string[] = []
  for await (const file of new Glob('**/*.ts').scan(import.meta.dir)) {
    if (file.endsWith('.test.ts')) continue
    const lines = (await Bun.file(`${import.meta.dir}/${file}`).text()).split('\n')
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '')
      if (FORBIDDEN.some((re) => re.test(code))) offenders.push(`${file}:${i + 1}: ${line.trim()}`)
    })
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

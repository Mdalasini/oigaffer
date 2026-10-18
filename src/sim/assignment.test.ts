import { describe, expect, test } from 'bun:test'
import { assign } from './assignment'
import { createRng } from './rng'

/** The cheapest total by trying every way of giving rows distinct columns, filling min(rows, cols) of them. */
function bruteForce(cost: number[][]): number {
  const rows = cost.length
  const cols = cost[0].length
  let best = Infinity
  const used = new Set<number>()
  const go = (r: number, total: number, filled: number) => {
    if (r === rows) {
      if (filled === Math.min(rows, cols)) best = Math.min(best, total)
      return
    }
    go(r + 1, total, filled)
    for (let c = 0; c < cols; c++) {
      if (used.has(c)) continue
      used.add(c)
      go(r + 1, total + cost[r][c], filled + 1)
      used.delete(c)
    }
  }
  go(0, 0, 0)
  return best
}

describe('assignment', () => {
  test('finds the cheapest assignment, square or not', () => {
    const rng = createRng(4)
    for (const [rows, cols] of [[1, 1], [2, 2], [3, 3], [4, 4], [2, 4], [4, 2], [5, 3]]) {
      for (let k = 0; k < 20; k++) {
        const cost = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.round(rng() * 20) / 2 - 3))
        const result = assign(cost)
        const taken = result.filter((c) => c !== -1)
        expect(new Set(taken).size).toBe(taken.length)
        expect(taken.length).toBe(Math.min(rows, cols))
        const total = result.reduce((sum, c, r) => sum + (c === -1 ? 0 : cost[r][c]), 0)
        expect(total).toBeCloseTo(bruteForce(cost), 6)
      }
    }
  })

  test('handles an empty side', () => {
    expect(assign([])).toEqual([])
    expect(assign([[], []])).toEqual([-1, -1])
  })
})

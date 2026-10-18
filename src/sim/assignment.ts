/**
 * The cheapest way to give each row (a player) at most one column (a job),
 * each job to at most one player, filling as many as possible: the
 * Hungarian algorithm, O(n³). `cost[r][c]` is what it costs row r to take
 * column c. Returns, for each row, its column, or -1 if it gets none (only
 * when there are more rows than columns).
 */
export function assign(cost: number[][]): number[] {
  const rows = cost.length
  const cols = rows ? cost[0].length : 0
  if (!rows || !cols) return new Array(rows).fill(-1)
  // Square it up with zero-cost dummy rows or columns.
  const n = Math.max(rows, cols)
  const a = (r: number, c: number) => (r < rows && c < cols ? cost[r][c] : 0)

  // Potentials u (rows) and v (cols), and p[c] = the row matched to column c, 1-based.
  const u = new Float64Array(n + 1)
  const v = new Float64Array(n + 1)
  const p = new Int32Array(n + 1)
  const way = new Int32Array(n + 1)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Float64Array(n + 1).fill(Infinity)
    const used = new Uint8Array(n + 1)
    do {
      used[j0] = 1
      const i0 = p[j0]
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue
        const cur = a(i0 - 1, j - 1) - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else minv[j] -= delta
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0)
  }

  const result = new Array(rows).fill(-1)
  for (let j = 1; j <= n; j++) {
    const r = p[j] - 1
    if (r >= 0 && r < rows && j - 1 < cols) result[r] = j - 1
  }
  return result
}

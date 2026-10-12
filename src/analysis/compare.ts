import { seededRng, type Rng } from "../random";
import type { Recording } from "./record";

// Control vs treatment: plays the same seeds with and without a change and compares any
// named numbers measured from each recording. Each recording is reduced as soon as it is
// played, so long runs don't hold every frame in memory.

export type Metrics = Record<string, number>;

export interface MetricComparison {
  name: string;
  control: number;
  treatment: number;
  diff: number;
  se: number; // standard error of the mean paired difference
  z: number; // diff / se: beyond about ±3 is very unlikely to be noise
}

export interface CompareOptions {
  count: number;
  seed: number;
  control: (rng: Rng) => Recording;
  treatment: (rng: Rng) => Recording;
  measure: (rec: Recording) => Metrics;
}

export function compare({ count, seed, control, treatment, measure }: CompareOptions): MetricComparison[] {
  const pairs = new Map<string, [number, number][]>();
  for (let i = 0; i < count; i++) {
    const a = measure(control(seededRng(seed + i)));
    const b = measure(treatment(seededRng(seed + i)));
    for (const name of Object.keys(a)) {
      const va = a[name]!;
      const vb = b[name];
      if (vb === undefined || !Number.isFinite(va) || !Number.isFinite(vb)) continue;
      if (!pairs.has(name)) pairs.set(name, []);
      pairs.get(name)!.push([va, vb]);
    }
  }
  return [...pairs].map(([name, values]) => {
    const n = values.length;
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
    const diffs = values.map(([a, b]) => b - a);
    const diff = mean(diffs);
    const variance = diffs.reduce((s, d) => s + (d - diff) ** 2, 0) / Math.max(1, n - 1);
    const se = Math.sqrt(variance / Math.max(1, n));
    return {
      name,
      control: mean(values.map(([a]) => a)),
      treatment: mean(values.map(([, b]) => b)),
      diff,
      se,
      z: se === 0 ? (diff === 0 ? 0 : Infinity) : diff / se,
    };
  });
}

export function formatComparison(rows: MetricComparison[]): string {
  const width = Math.max(6, ...rows.map((r) => r.name.length));
  const num = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)).padStart(9);
  const lines = [`${"metric".padEnd(width)}   control treatment      diff        se      z`];
  for (const r of rows) {
    const flag = Math.abs(r.z) >= 3 ? " *" : "";
    lines.push(`${r.name.padEnd(width)} ${num(r.control)} ${num(r.treatment)} ${num(r.diff)} ${num(r.se)} ${r.z.toFixed(1).padStart(6)}${flag}`);
  }
  return lines.join("\n");
}

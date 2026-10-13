export interface Vec {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v: Vec, k: number): Vec => ({ x: v.x * k, y: v.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const length = (v: Vec): number => Math.hypot(v.x, v.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const angleOf = (v: Vec): number => Math.atan2(v.y, v.x);
export const fromAngle = (angle: number, len = 1): Vec => ({ x: Math.cos(angle) * len, y: Math.sin(angle) * len });

export function normalize(v: Vec): Vec {
  const len = length(v);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

// Signed difference b − a, wrapped to [−π, π]
export function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

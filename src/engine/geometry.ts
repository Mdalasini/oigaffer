export interface Vec {
  x: number;
  y: number;
}

// Metres. x runs goal to goal, y runs touchline to touchline.
export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;
export const CENTRE: Vec = { x: PITCH_LENGTH / 2, y: PITCH_WIDTH / 2 };

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v: Vec, k: number): Vec => ({ x: v.x * k, y: v.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const length = (v: Vec): number => Math.hypot(v.x, v.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

export function normalize(v: Vec): Vec {
  const l = length(v);
  return l === 0 ? { x: 0, y: 0 } : scale(v, 1 / l);
}

export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const lenSq = dot(ab, ab);
  if (lenSq === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / lenSq));
  return dist(p, add(a, scale(ab, t)));
}

export function clampToPitch(v: Vec): Vec {
  return {
    x: Math.min(PITCH_LENGTH, Math.max(0, v.x)),
    y: Math.min(PITCH_WIDTH, Math.max(0, v.y)),
  };
}

// Kinematic arrive: step towards the target, stopping `standOff` metres short of it
export function moveTowards(from: Vec, to: Vec, maxStep: number, standOff = 0): Vec {
  const d = dist(from, to);
  if (d <= standOff) return { ...from };
  const step = Math.min(maxStep, d - standOff);
  return add(from, scale(sub(to, from), step / d));
}

import type { Vec3 } from '../sim/shooting'

export type Mat4 = Float32Array

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
export const normalize = (a: Vec3): Vec3 => {
  const len = Math.hypot(a.x, a.y, a.z) || 1
  return { x: a.x / len, y: a.y / len, z: a.z / len }
}

/** Column-major view matrix plus the camera's right/up axes in world space. */
export function lookAt(eye: Vec3, target: Vec3, worldUp: Vec3) {
  const f = normalize(sub(target, eye))
  const right = normalize(cross(f, worldUp))
  const up = cross(right, f)
  // prettier-ignore
  const view = new Float32Array([
    right.x, up.x, -f.x, 0,
    right.y, up.y, -f.y, 0,
    right.z, up.z, -f.z, 0,
    -dot(right, eye), -dot(up, eye), dot(f, eye), 1,
  ])
  return { view, right, up }
}

export function ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  // prettier-ignore
  return new Float32Array([
    2 / (right - left), 0, 0, 0,
    0, 2 / (top - bottom), 0, 0,
    0, 0, -2 / (far - near), 0,
    -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1,
  ])
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k]
      out[col * 4 + row] = sum
    }
  }
  return out
}

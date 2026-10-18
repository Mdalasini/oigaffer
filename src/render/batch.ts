import type { Vec3 } from '../sim/shooting'

export type Color = readonly [number, number, number, number]

const FLOATS_PER_VERTEX = 7

/** Growable list of coloured triangles in world space. */
class TriangleList {
  data = new Float32Array(4096 * FLOATS_PER_VERTEX)
  length = 0

  get vertexCount() {
    return this.length / FLOATS_PER_VERTEX
  }

  vertex(x: number, y: number, z: number, c: Color) {
    if (this.length + FLOATS_PER_VERTEX > this.data.length) {
      const grown = new Float32Array(this.data.length * 2)
      grown.set(this.data)
      this.data = grown
    }
    const d = this.data
    let i = this.length
    d[i++] = x
    d[i++] = y
    d[i++] = z
    d[i++] = c[0]
    d[i++] = c[1]
    d[i++] = c[2]
    d[i++] = c[3]
    this.length = i
  }
}

/**
 * Collects 3D geometry for one frame. Translucent triangles are kept apart so
 * they can be drawn after the opaque ones without writing depth.
 */
export class Batch {
  readonly opaque = new TriangleList()
  readonly translucent = new TriangleList()

  clear() {
    this.opaque.length = 0
    this.translucent.length = 0
  }

  tri(a: Vec3, b: Vec3, c: Vec3, color: Color) {
    const list = color[3] < 1 ? this.translucent : this.opaque
    list.vertex(a.x, a.y, a.z, color)
    list.vertex(b.x, b.y, b.z, color)
    list.vertex(c.x, c.y, c.z, color)
  }

  /** Parallelogram centred on `c` with half-extent vectors `u` and `v`. */
  quad(c: Vec3, u: Vec3, v: Vec3, color: Color) {
    const p = (su: number, sv: number): Vec3 => ({
      x: c.x + u.x * su + v.x * sv,
      y: c.y + u.y * su + v.y * sv,
      z: c.z + u.z * su + v.z * sv,
    })
    const a = p(-1, -1)
    const b = p(1, -1)
    const d = p(1, 1)
    const e = p(-1, 1)
    this.tri(a, b, d, color)
    this.tri(a, d, e, color)
  }

  /** Ellipse in the plane spanned by unit axes `u`, `v`. */
  disc(c: Vec3, u: Vec3, v: Vec3, radius: number, color: Color, segments = 24) {
    let prev = this.onCircle(c, u, v, radius, 0)
    for (let i = 1; i <= segments; i++) {
      const next = this.onCircle(c, u, v, radius, (i / segments) * Math.PI * 2)
      this.tri(c, prev, next, color)
      prev = next
    }
  }

  /** Arc band between radius ± width/2, from angle a0 to a1. */
  arc(c: Vec3, u: Vec3, v: Vec3, radius: number, width: number, a0: number, a1: number, color: Color, segments = 48) {
    const inner = radius - width / 2
    const outer = radius + width / 2
    for (let i = 0; i < segments; i++) {
      const t0 = a0 + ((a1 - a0) * i) / segments
      const t1 = a0 + ((a1 - a0) * (i + 1)) / segments
      const i0 = this.onCircle(c, u, v, inner, t0)
      const o0 = this.onCircle(c, u, v, outer, t0)
      const i1 = this.onCircle(c, u, v, inner, t1)
      const o1 = this.onCircle(c, u, v, outer, t1)
      this.tri(i0, o0, o1, color)
      this.tri(i0, o1, i1, color)
    }
  }

  /** Axis-aligned box, with faces lightly shaded so edges read in any view. */
  box(min: Vec3, max: Vec3, color: Color) {
    const centre = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 }
    const half = { x: (max.x - min.x) / 2, y: (max.y - min.y) / 2, z: (max.z - min.z) / 2 }
    this.orientedBox(centre, half, 0, color)
  }

  /** Box with half-extents `half` in its own frame, turned `yaw` radians about z. */
  orientedBox(c: Vec3, half: Vec3, yaw: number, color: Color) {
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    const ax = { x: cos * half.x, y: sin * half.x, z: 0 }
    const ay = { x: -sin * half.y, y: cos * half.y, z: 0 }
    const az = { x: 0, y: 0, z: half.z }
    const at = (a: Vec3, sign: number): Vec3 => ({ x: c.x + a.x * sign, y: c.y + a.y * sign, z: c.z + a.z * sign })
    const shade = (k: number): Color => [color[0] * k, color[1] * k, color[2] * k, color[3]]
    this.quad(at(az, 1), ax, ay, color)
    this.quad(at(az, -1), ax, ay, shade(0.6))
    this.quad(at(ax, 1), ay, az, shade(0.85))
    this.quad(at(ax, -1), ay, az, shade(0.85))
    this.quad(at(ay, 1), ax, az, shade(0.75))
    this.quad(at(ay, -1), ax, az, shade(0.75))
  }

  /** Flat strip of `width` on the ground between two points. */
  groundLine(x0: number, y0: number, x1: number, y1: number, width: number, z: number, color: Color) {
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy)
    const half = width / 2
    this.quad(
      { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z },
      { x: dx / 2, y: dy / 2, z: 0 },
      { x: (-dy / len) * half, y: (dx / len) * half, z: 0 },
      color,
    )
  }

  private onCircle(c: Vec3, u: Vec3, v: Vec3, r: number, angle: number): Vec3 {
    const cos = Math.cos(angle) * r
    const sin = Math.sin(angle) * r
    return { x: c.x + u.x * cos + v.x * sin, y: c.y + u.y * cos + v.y * sin, z: c.z + u.z * cos + v.z * sin }
  }
}

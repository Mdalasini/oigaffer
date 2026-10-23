// Maps world metres to canvas pixels: the given world rect is fitted into the
// canvas, centred, with world +y pointing up the screen.

export interface View {
  /** Device pixels per metre. */
  scale: number
  /** Device-pixel position of the world origin. */
  originX: number
  originY: number
  width: number
  height: number
}

export function fitView(width: number, height: number, worldW: number, worldH: number): View {
  const scale = Math.min(width / worldW, height / worldH)
  return { scale, originX: width / 2, originY: height / 2, width, height }
}

export function worldToScreen(v: View, x: number, y: number): [number, number] {
  return [v.originX + x * v.scale, v.originY - y * v.scale]
}

export function screenToWorld(v: View, px: number, py: number): [number, number] {
  return [(px - v.originX) / v.scale, (v.originY - py) / v.scale]
}

/** Column-major mat3 taking world metres to clip space. */
export function clipMatrix(v: View): Float32Array {
  const sx = (2 * v.scale) / v.width
  const sy = (2 * v.scale) / v.height
  const tx = (2 * v.originX) / v.width - 1
  const ty = 1 - (2 * v.originY) / v.height
  return new Float32Array([sx, 0, 0, 0, sy, 0, tx, ty, 1])
}

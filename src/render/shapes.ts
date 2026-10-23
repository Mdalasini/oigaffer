// Instanced WebGL2 renderer for flat 2D shapes. Every shape is one instanced
// quad; the fragment shader draws a rect, disc or ring with an analytic
// signed-distance edge so lines stay crisp at any zoom.

import { clipMatrix, type View } from './view'

export type Color = readonly [number, number, number, number]

const KIND_RECT = 0
const KIND_DISC = 1
const KIND_RING = 2
// cx, cy, halfW, halfH, angle, kind, param, r, g, b, a
const FLOATS = 11
const MAX_INSTANCES = 8192

const VERT = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_geom;
layout(location=2) in vec3 a_extra;
layout(location=3) in vec4 a_color;
uniform mat3 u_clip;
uniform float u_scale;
out vec2 v_local;
out vec2 v_half;
flat out float v_kind;
flat out float v_param;
out vec4 v_color;
void main() {
  vec2 pad = a_geom.zw + vec2(1.5 / u_scale);
  vec2 local = a_corner * pad;
  float c = cos(a_extra.x), s = sin(a_extra.x);
  vec2 world = a_geom.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  gl_Position = vec4((u_clip * vec3(world, 1.0)).xy, 0.0, 1.0);
  v_local = local;
  v_half = a_geom.zw;
  v_kind = a_extra.y;
  v_param = a_extra.z;
  v_color = a_color;
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 v_local;
in vec2 v_half;
flat in float v_kind;
flat in float v_param;
in vec4 v_color;
uniform float u_scale;
out vec4 outColor;
void main() {
  float d;
  if (v_kind < 0.5) {
    vec2 q = abs(v_local) - v_half;
    d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  } else if (v_kind < 1.5) {
    d = length(v_local) - v_half.x;
  } else {
    d = abs(length(v_local) - (v_half.x - v_param * 0.5)) - v_param * 0.5;
  }
  float alpha = clamp(0.5 - d * u_scale, 0.0, 1.0) * v_color.a;
  if (alpha <= 0.0) discard;
  outColor = vec4(v_color.rgb * alpha, alpha);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader')
  return sh
}

export class ShapeRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private vao: WebGLVertexArrayObject
  private instanceBuf: WebGLBuffer
  private data = new Float32Array(MAX_INSTANCES * FLOATS)
  private count = 0
  private uClip: WebGLUniformLocation
  private uScale: WebGLUniformLocation

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true })
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link')
    this.program = program
    this.uClip = gl.getUniformLocation(program, 'u_clip')!
    this.uScale = gl.getUniformLocation(program, 'u_scale')!

    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    const corners = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, corners)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    this.instanceBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf)
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW)
    const stride = FLOATS * 4
    const attrs: [number, number, number][] = [
      [1, 4, 0],
      [2, 3, 16],
      [3, 4, 28],
    ]
    for (const [loc, size, offset] of attrs) {
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset)
      gl.vertexAttribDivisor(loc, 1)
    }
    gl.bindVertexArray(null)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  begin(view: View, clear: Color): void {
    const gl = this.gl
    gl.viewport(0, 0, view.width, view.height)
    gl.clearColor(clear[0], clear[1], clear[2], clear[3])
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.uniformMatrix3fv(this.uClip, false, clipMatrix(view))
    gl.uniform1f(this.uScale, view.scale)
    this.count = 0
  }

  private push(cx: number, cy: number, hw: number, hh: number, angle: number, kind: number, param: number, c: Color) {
    if (this.count === MAX_INSTANCES) this.flush()
    const o = this.count++ * FLOATS
    const d = this.data
    d[o] = cx
    d[o + 1] = cy
    d[o + 2] = hw
    d[o + 3] = hh
    d[o + 4] = angle
    d[o + 5] = kind
    d[o + 6] = param
    d[o + 7] = c[0]
    d[o + 8] = c[1]
    d[o + 9] = c[2]
    d[o + 10] = c[3]
  }

  rect(cx: number, cy: number, w: number, h: number, color: Color, angle = 0): void {
    this.push(cx, cy, w / 2, h / 2, angle, KIND_RECT, 0, color)
  }

  disc(cx: number, cy: number, r: number, color: Color): void {
    this.push(cx, cy, r, r, 0, KIND_DISC, 0, color)
  }

  ring(cx: number, cy: number, r: number, thickness: number, color: Color): void {
    this.push(cx, cy, r, r, 0, KIND_RING, thickness, color)
  }

  line(x1: number, y1: number, x2: number, y2: number, width: number, color: Color): void {
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy)
    this.push((x1 + x2) / 2, (y1 + y2) / 2, len / 2 + width / 2, width / 2, Math.atan2(dy, dx), KIND_RECT, 0, color)
  }

  arc(cx: number, cy: number, r: number, from: number, to: number, width: number, color: Color, segments = 24): void {
    let px = cx + r * Math.cos(from)
    let py = cy + r * Math.sin(from)
    for (let i = 1; i <= segments; i++) {
      const a = from + ((to - from) * i) / segments
      const x = cx + r * Math.cos(a)
      const y = cy + r * Math.sin(a)
      this.line(px, py, x, y, width, color)
      px = x
      py = y
    }
  }

  flush(): void {
    if (this.count === 0) return
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * FLOATS)
    gl.bindVertexArray(this.vao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count)
    gl.bindVertexArray(null)
    this.count = 0
  }
}

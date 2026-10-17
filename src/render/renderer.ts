import type { Batch, Color } from './batch'
import type { Mat4 } from './mat4'

const VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
in vec4 aColor;
uniform mat4 uViewProjection;
out vec4 vColor;
void main() {
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
  vColor = aColor;
}`

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() {
  outColor = vColor;
}`

/** Pixel rectangle in the drawing buffer, origin bottom-left. */
export interface Viewport {
  x: number
  y: number
  width: number
  height: number
}

/** Draws `Batch` geometry through a view-projection matrix with WebGL2. */
export class Renderer {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly buffer: WebGLBuffer
  private readonly vao: WebGLVertexArrayObject
  private readonly uViewProjection: WebGLUniformLocation

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true })
    if (!gl) throw new Error('WebGL2 is not available in this browser')
    this.gl = gl
    this.program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER)
    this.uViewProjection = gl.getUniformLocation(this.program, 'uViewProjection')!
    this.buffer = gl.createBuffer()!
    this.vao = gl.createVertexArray()!

    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    const stride = 7 * 4
    const aPosition = gl.getAttribLocation(this.program, 'aPosition')
    gl.enableVertexAttribArray(aPosition)
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, stride, 0)
    const aColor = gl.getAttribLocation(this.program, 'aColor')
    gl.enableVertexAttribArray(aColor)
    gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, stride, 3 * 4)
    gl.bindVertexArray(null)

    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  }

  /** Matches the drawing buffer to the canvas's CSS size; returns the DPR used. */
  resize(): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.round(this.canvas.clientWidth * dpr)
    const height = Math.round(this.canvas.clientHeight * dpr)
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    return dpr
  }

  draw(batch: Batch, viewProjection: Mat4, viewport: Viewport, clear: Color) {
    const gl = this.gl
    gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height)
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(viewport.x, viewport.y, viewport.width, viewport.height)
    gl.clearColor(clear[0], clear[1], clear[2], clear[3])
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    gl.useProgram(this.program)
    gl.uniformMatrix4fv(this.uViewProjection, false, viewProjection)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)

    gl.disable(gl.BLEND)
    gl.depthMask(true)
    this.drawList(batch.opaque.data, batch.opaque.length, batch.opaque.vertexCount)

    gl.enable(gl.BLEND)
    gl.depthMask(false)
    this.drawList(batch.translucent.data, batch.translucent.length, batch.translucent.vertexCount)
    gl.depthMask(true)

    gl.bindVertexArray(null)
    gl.disable(gl.SCISSOR_TEST)
  }

  private drawList(data: Float32Array, length: number, vertexCount: number) {
    if (vertexCount === 0) return
    const gl = this.gl
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, length), gl.DYNAMIC_DRAW)
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount)
  }
}

function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`)
  }
  return program
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`)
  }
  return shader
}

import { useEffect, useRef } from 'react'
import { drawPitch, SURROUND } from '../render/pitch'
import { ShapeRenderer } from '../render/shapes'
import { fitView } from '../render/view'
import { PITCH_LENGTH, PITCH_WIDTH } from '../sim/pitch'

const MARGIN = 6

export function PitchCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const renderer = new ShapeRenderer(canvas)
    let frame = 0
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const view = fitView(w, h, PITCH_LENGTH + MARGIN * 2, PITCH_WIDTH + MARGIN * 2)
      renderer.begin(view, SURROUND)
      drawPitch(renderer)
      renderer.flush()
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  return <canvas ref={canvasRef} className="pitch" />
}

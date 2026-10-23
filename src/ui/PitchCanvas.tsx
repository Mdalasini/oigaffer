import { useEffect, useRef } from 'react'
import type { Game } from '../game/Game'
import { drawPitch, SURROUND } from '../render/pitch'
import { drawLabels, drawScene } from '../render/scene'
import { ShapeRenderer } from '../render/shapes'
import { fitView } from '../render/view'
import { PITCH_LENGTH, PITCH_WIDTH } from '../sim/pitch'

const MARGIN = 6

export function PitchCanvas({ game }: { game: Game }) {
  const glRef = useRef<HTMLCanvasElement>(null)
  const labelRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = glRef.current!
    const labels = labelRef.current!
    const ctx = labels.getContext('2d')!
    const renderer = new ShapeRenderer(canvas)
    let frame = 0
    let last = performance.now()
    const draw = (now: number) => {
      const alpha = game.advance((now - last) / 1000)
      last = now
      const dpr = window.devicePixelRatio || 1
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      for (const c of [canvas, labels]) {
        if (c.width !== w || c.height !== h) {
          c.width = w
          c.height = h
        }
      }
      const view = fitView(w, h, PITCH_LENGTH + MARGIN * 2, PITCH_WIDTH + MARGIN * 2)
      renderer.begin(view, SURROUND)
      drawPitch(renderer)
      drawScene(renderer, game.sim, game.prev, alpha)
      renderer.flush()
      drawLabels(ctx, view, game.sim, game.prev, alpha)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [game])

  return (
    <div className="pitch">
      <canvas ref={glRef} />
      <canvas ref={labelRef} />
    </div>
  )
}

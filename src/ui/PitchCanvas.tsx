import { useEffect, useRef } from 'react'
import type { Game } from '../game/Game'
import { drawPitch, SURROUND } from '../render/pitch'
import { drawLabels, drawScene, framePose, livePose, pick, type Pose } from '../render/scene'
import { ShapeRenderer } from '../render/shapes'
import { fitView, screenToWorld, type View } from '../render/view'
import { PITCH_LENGTH, PITCH_WIDTH } from '../sim/pitch'

const MARGIN = 6

export function PitchCanvas({ game }: { game: Game }) {
  const glRef = useRef<HTMLCanvasElement>(null)
  const labelRef = useRef<HTMLCanvasElement>(null)
  const shown = useRef<{ view: View; pose: Pose } | null>(null)

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
      const pose = game.scrubTick === null ? livePose(game.sim, game.prev, alpha) : framePose(game.rec, game.scrubTick)
      shown.current = { view, pose }
      renderer.begin(view, SURROUND)
      drawPitch(renderer)
      drawScene(renderer, game.sim, pose, game.selected)
      renderer.flush()
      drawLabels(ctx, view, game.sim, pose)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [game])

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!shown.current) return
    const { view, pose } = shown.current
    const rect = e.currentTarget.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const [x, y] = screenToWorld(view, (e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr)
    const eid = pick(game.sim, pose, x, y)
    if (eid >= 0) game.toggleSelected(eid, e.shiftKey || e.metaKey)
  }

  return (
    <div className="pitch">
      <canvas ref={glRef} />
      <canvas ref={labelRef} onClick={onClick} />
    </div>
  )
}

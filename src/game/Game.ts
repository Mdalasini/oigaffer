import { Batch } from '../render/batch'
import { goalCamera, topDownCamera } from '../render/cameras'
import { Renderer } from '../render/renderer'
import { buildScene } from '../render/scene'
import { Goalkeeper, Outfielder } from '../sim/components'
import { FIXED_DT } from '../sim/constants'
import { reactionDelay, shotSpreadRadius } from '../sim/grades'
import { createMatch, requestShot, resetPlay, setGrades, stepMatch, type Match, type MatchStats, type Outcome, type Phase } from '../sim/match'

export interface GameSnapshot {
  phase: Phase
  outcome: Outcome | null
  stats: MatchStats
  shooting: number
  reaction: number
  spreadRadius: number
  reactionDelay: number
  autoReset: boolean
}

const PITCH_SKY: readonly [number, number, number, number] = [0.08, 0.1, 0.14, 1]
const GOAL_SKY: readonly [number, number, number, number] = [0.16, 0.2, 0.28, 1]

/** Owns the simulation, the fixed-step loop and the WebGL views of it. */
export class Game {
  readonly match: Match
  private readonly batch = new Batch()
  private readonly listeners = new Set<() => void>()
  private snapshot: GameSnapshot
  private snapshotKey = ''

  constructor(shooting = 14, reaction = 12) {
    this.match = createMatch({ shooting, reaction })
    this.snapshot = this.takeSnapshot()
  }

  /** Starts drawing into `canvas`; the goal view fills `inset`'s on-screen box. */
  mount(canvas: HTMLCanvasElement, inset: HTMLElement): () => void {
    const renderer = new Renderer(canvas)
    let raf = 0
    let last = performance.now()
    let accumulator = 0

    const frame = (now: number) => {
      accumulator += Math.min((now - last) / 1000, 0.1)
      last = now
      while (accumulator >= FIXED_DT) {
        stepMatch(this.match, FIXED_DT)
        accumulator -= FIXED_DT
      }
      this.render(renderer, canvas, inset)
      this.publishIfChanged()
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  setShooting(grade: number) {
    setGrades(this.match, grade, Goalkeeper.reaction[this.match.keeper])
    this.publishIfChanged()
  }

  setReaction(grade: number) {
    setGrades(this.match, Outfielder.shooting[this.match.striker], grade)
    this.publishIfChanged()
  }

  setAutoReset(on: boolean) {
    this.match.autoReset = on
    this.publishIfChanged()
  }

  shoot() {
    requestShot(this.match)
  }

  reset() {
    resetPlay(this.match)
    this.publishIfChanged()
  }

  private render(renderer: Renderer, canvas: HTMLCanvasElement, inset: HTMLElement) {
    const dpr = renderer.resize()
    const main = { x: 0, y: 0, width: canvas.width, height: canvas.height }
    const top = topDownCamera(main.width / main.height)
    buildScene(this.batch, this.match, top)
    renderer.draw(this.batch, top.viewProjection, main, PITCH_SKY)

    const c = canvas.getBoundingClientRect()
    const r = inset.getBoundingClientRect()
    const view = {
      x: Math.round((r.left - c.left) * dpr),
      y: Math.round((c.bottom - r.bottom) * dpr),
      width: Math.round(r.width * dpr),
      height: Math.round(r.height * dpr),
    }
    if (view.width <= 0 || view.height <= 0) return
    const goal = goalCamera(view.width / view.height)
    buildScene(this.batch, this.match, goal)
    renderer.draw(this.batch, goal.viewProjection, view, GOAL_SKY)
  }

  private takeSnapshot(): GameSnapshot {
    const m = this.match
    const shooting = Outfielder.shooting[m.striker]
    const reaction = Goalkeeper.reaction[m.keeper]
    return {
      phase: m.phase,
      outcome: m.outcome,
      stats: { ...m.stats },
      shooting,
      reaction,
      spreadRadius: shotSpreadRadius(shooting),
      reactionDelay: reactionDelay(reaction),
      autoReset: m.autoReset,
    }
  }

  private publishIfChanged() {
    const m = this.match
    const key = [m.phase, m.outcome, m.stats.shots, Outfielder.shooting[m.striker], Goalkeeper.reaction[m.keeper], m.autoReset].join('|')
    if (key === this.snapshotKey) return
    this.snapshotKey = key
    this.snapshot = this.takeSnapshot()
    for (const listener of this.listeners) listener()
  }
}

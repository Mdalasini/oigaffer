import { Batch } from '../render/batch'
import { goalCamera, topDownCamera, topDownExtent } from '../render/cameras'
import { Renderer } from '../render/renderer'
import { buildScene } from '../render/scene'
import { Position } from '../sim/components'
import { FIXED_DT, GOAL_DEPTH, GOAL_X } from '../sim/constants'
import {
  createMatch,
  getGrade,
  GRADE_FIELDS,
  requestShot,
  resetPlay,
  setGrade,
  stepMatch,
  type GradeKey,
  type Grades,
  type Match,
  type MatchStats,
  type Outcome,
  type Phase,
} from '../sim/match'

export interface GameSnapshot {
  phase: Phase
  outcome: Outcome | null
  stats: MatchStats
  grades: Grades
  autoReset: boolean
}

const GRADE_KEYS = Object.keys(GRADE_FIELDS) as GradeKey[]

const PITCH_SKY: readonly [number, number, number, number] = [0.08, 0.1, 0.14, 1]
const GOAL_SKY: readonly [number, number, number, number] = [0.16, 0.2, 0.28, 1]

/** Owns the simulation, the fixed-step loop and the WebGL views of it. */
export class Game {
  readonly match: Match
  private readonly batch = new Batch()
  private readonly listeners = new Set<() => void>()
  private snapshot: GameSnapshot
  private snapshotKey = ''
  /** Where the top-down camera is looking; eases after the ball. */
  private readonly view = { x: GOAL_X - 20, y: 0 }

  constructor() {
    this.match = createMatch()
    this.snapshot = this.takeSnapshot()
  }

  /** Starts drawing into `canvas`; the goal view fills `inset`'s on-screen box. */
  mount(canvas: HTMLCanvasElement, inset: HTMLElement): () => void {
    const renderer = new Renderer(canvas)
    let raf = 0
    let last = performance.now()
    let accumulator = 0

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      accumulator += dt
      last = now
      while (accumulator >= FIXED_DT) {
        stepMatch(this.match, FIXED_DT)
        accumulator -= FIXED_DT
      }
      this.render(renderer, canvas, inset, dt)
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

  setGrade(key: GradeKey, grade: number) {
    setGrade(this.match, key, grade)
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

  private render(renderer: Renderer, canvas: HTMLCanvasElement, inset: HTMLElement, dt: number) {
    const dpr = renderer.resize()
    const main = { x: 0, y: 0, width: canvas.width, height: canvas.height }
    this.follow(main.width / main.height, dt)
    const top = topDownCamera(main.width / main.height, this.view)
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

  /** Eases the top-down view towards the ball, looking ahead towards goal but never past it. */
  private follow(aspect: number, dt: number) {
    const ball = this.match.ball
    const { halfH } = topDownExtent(aspect)
    const targetX = Math.min(Position.x[ball] + halfH * 0.35, GOAL_X + GOAL_DEPTH + 1 - halfH)
    const targetY = Position.y[ball] * 0.8
    const k = 1 - Math.exp(-3 * dt)
    this.view.x += (targetX - this.view.x) * k
    this.view.y += (targetY - this.view.y) * k
  }

  private takeSnapshot(): GameSnapshot {
    const m = this.match
    return {
      phase: m.phase,
      outcome: m.outcome,
      stats: { ...m.stats },
      grades: Object.fromEntries(GRADE_KEYS.map((key) => [key, getGrade(m, key)])) as Grades,
      autoReset: m.autoReset,
    }
  }

  private publishIfChanged() {
    const m = this.match
    const grades = GRADE_KEYS.map((key) => getGrade(m, key))
    const key = [m.phase, m.outcome, m.stats.shots, m.autoReset, ...grades].join('|')
    if (key === this.snapshotKey) return
    this.snapshotKey = key
    this.snapshot = this.takeSnapshot()
    for (const listener of this.listeners) listener()
  }
}

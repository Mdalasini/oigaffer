import { Batch } from '../render/batch'
import { goalCamera, pitchCamera } from '../render/cameras'
import { Renderer } from '../render/renderer'
import { buildScene } from '../render/scene'
import type { ChallengeKind, ChallengeResult } from '../sim/challenge'
import { Defender, DefenderMode, Shield } from '../sim/components'
import { FIXED_DT } from '../sim/constants'
import {
  createMatch,
  getGrade,
  gradeKeys,
  requestShot,
  resetPlay,
  ROLES,
  setDefenderActive,
  setGrade,
  stepMatch,
  type GradeKey,
  type Grades,
  type Match,
  type MatchStats,
  type Outcome,
  type Phase,
  type Restart,
  type Role,
} from '../sim/match'

export interface GameSnapshot {
  phase: Phase
  outcome: Outcome | null
  /** How play restarts, when the ball went out. */
  restart: Restart | null
  stats: MatchStats
  grades: Grades
  autoReset: boolean
  defenderActive: boolean
  /** What the defender is doing, while it is in play. */
  defenderMode: DefenderMode | null
  strikerShielding: boolean
  /** The latest tackle or barge, for a moment after it happens. */
  challenge: { kind: ChallengeKind; result: ChallengeResult } | null
}

/** How long (s) a challenge result stays on screen. */
const CHALLENGE_SHOWN_FOR = 1.4

const PITCH_SKY: readonly [number, number, number, number] = [0.08, 0.1, 0.14, 1]
const GOAL_SKY: readonly [number, number, number, number] = [0.16, 0.2, 0.28, 1]

/** Owns the simulation, the fixed-step loop and the WebGL views of it. */
export class Game {
  readonly match: Match
  private readonly batch = new Batch()
  private readonly listeners = new Set<() => void>()
  private snapshot: GameSnapshot
  private snapshotKey = ''

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

  setGrade<R extends Role>(role: R, key: GradeKey<R>, grade: number) {
    setGrade(this.match, role, key, grade)
    this.publishIfChanged()
  }

  setDefenderActive(on: boolean) {
    setDefenderActive(this.match, on)
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
    const top = pitchCamera(main.width / main.height)
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
    return {
      phase: m.phase,
      outcome: m.outcome,
      restart: m.restart,
      stats: { ...m.stats },
      grades: Object.fromEntries(
        ROLES.map((role) => [role, Object.fromEntries(gradeKeys(role).map((key) => [key, getGrade(m, role, key)]))]),
      ) as Grades,
      autoReset: m.autoReset,
      defenderActive: m.defenderActive,
      defenderMode: this.defenderMode(),
      strikerShielding: this.strikerShielding(),
      challenge: this.recentChallenge(),
    }
  }

  private strikerShielding() {
    const m = this.match
    return m.defenderActive && m.phase === 'approach' && Shield.active[m.striker] === 1
  }

  private recentChallenge() {
    const c = this.match.lastChallenge
    return c && this.match.time - c.time < CHALLENGE_SHOWN_FOR ? { kind: c.kind, result: c.result } : null
  }

  private defenderMode(): DefenderMode | null {
    const m = this.match
    return m.defenderActive && m.phase === 'approach' ? (Defender.mode[m.defender] as DefenderMode) : null
  }

  private publishIfChanged() {
    const m = this.match
    const grades = ROLES.flatMap((role) => gradeKeys(role).map((key) => getGrade(m, role, key)))
    const challenge = this.recentChallenge()
    const key = [
      m.phase,
      m.outcome,
      m.stats.shots,
      m.stats.lost,
      m.stats.setPieces,
      m.autoReset,
      m.defenderActive,
      this.defenderMode(),
      this.strikerShielding(),
      challenge && `${challenge.kind}:${challenge.result}:${m.lastChallenge?.time}`,
      ...grades,
    ].join('|')
    if (key === this.snapshotKey) return
    this.snapshotKey = key
    this.snapshot = this.takeSnapshot()
    for (const listener of this.listeners) listener()
  }
}

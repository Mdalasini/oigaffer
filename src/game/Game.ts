import { Batch } from '../render/batch'
import { goalCamera, pitchCamera } from '../render/cameras'
import type { Overlay } from '../render/overlay'
import { Renderer } from '../render/renderer'
import { buildScene } from '../render/scene'
import type { ChallengeKind, ChallengeResult } from '../sim/challenge'
import { Defender, DefenderMode, Shield, Team } from '../sim/components'
import { FIXED_DT } from '../sim/constants'
import {
  createMatch,
  getGrade,
  gradeKeys,
  requestShot,
  resetMatch,
  ROLES,
  setGrade,
  stepMatch,
  type GradeKey,
  type Grades,
  type Match,
  type MatchEventKind,
  type Phase,
  type RestartKind,
  type Role,
  type TeamStats,
} from '../sim/match'
import { attackedGoalX, TEAM_NAMES, type TeamName } from '../sim/teams'

export interface GameSnapshot {
  phase: Phase
  /** The team on the ball. */
  possession: number
  /** The latest notable moment, while it's still news. */
  event: { kind: MatchEventKind; team: number } | null
  /** How play restarts, while the ball is dead. */
  restart: { kind: RestartKind; team: number } | null
  stats: [TeamStats, TeamStats]
  grades: Grades
  /** What the defending outfielder is doing, in open play. */
  defenderMode: DefenderMode | null
  carrierShielding: boolean
  /** The latest tackle or barge, for a moment after it happens. */
  challenge: { kind: ChallengeKind; result: ChallengeResult } | null
  overlay: Overlay
}

/** How long (s) a challenge result or a turnover stays on screen. */
const CHALLENGE_SHOWN_FOR = 1.4
const EVENT_SHOWN_FOR = 1.6

const PITCH_SKY: readonly [number, number, number, number] = [0.08, 0.1, 0.14, 1]
const GOAL_SKY: readonly [number, number, number, number] = [0.16, 0.2, 0.28, 1]

/** Owns the simulation, the fixed-step loop and the WebGL views of it. */
export class Game {
  readonly match: Match
  private readonly batch = new Batch()
  private readonly listeners = new Set<() => void>()
  private snapshot: GameSnapshot
  private snapshotKey = ''
  private overlay: Overlay = 'off'

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

  setGrade<R extends Role>(team: TeamName, role: R, key: GradeKey<R>, grade: number) {
    setGrade(this.match, team, role, key, grade)
    this.publishIfChanged()
  }

  /** Shows the space model over the pitch, or hides it. */
  setOverlay(overlay: Overlay) {
    this.overlay = overlay
    this.publishIfChanged()
  }

  shoot() {
    requestShot(this.match)
  }

  /** A fresh match: score cleared, red to kick off. */
  reset() {
    resetMatch(this.match)
    this.publishIfChanged()
  }

  private render(renderer: Renderer, canvas: HTMLCanvasElement, inset: HTMLElement) {
    const dpr = renderer.resize()
    const main = { x: 0, y: 0, width: canvas.width, height: canvas.height }
    const top = pitchCamera(main.width / main.height)
    buildScene(this.batch, this.match, top, this.overlay)
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
    const goal = goalCamera(view.width / view.height, this.goalInView())
    buildScene(this.batch, this.match, goal)
    renderer.draw(this.batch, goal.viewProjection, view, GOAL_SKY)
  }

  /** The goal under attack, or the one a shot went at until play restarts. */
  private goalInView() {
    const m = this.match
    return m.shot ? m.shot.goalX : attackedGoalX(Team.id[m.carrier])
  }

  private takeSnapshot(): GameSnapshot {
    const m = this.match
    return {
      phase: m.phase,
      possession: m.possession,
      event: this.recentEvent(),
      restart: m.restart && { kind: m.restart.kind, team: m.restart.team },
      stats: [{ ...m.stats[0] }, { ...m.stats[1] }],
      grades: Object.fromEntries(
        TEAM_NAMES.map((team) => [
          team,
          Object.fromEntries(ROLES.map((role) => [role, Object.fromEntries(gradeKeys(role).map((key) => [key, getGrade(m, team, role, key)]))])),
        ]),
      ) as Grades,
      defenderMode: this.defenderMode(),
      carrierShielding: this.carrierShielding(),
      challenge: this.recentChallenge(),
      overlay: this.overlay,
    }
  }

  private carrierShielding() {
    const m = this.match
    return m.phase === 'play' && Shield.active[m.carrier] === 1
  }

  private recentChallenge() {
    const c = this.match.lastChallenge
    return c && this.match.time - c.time < CHALLENGE_SHOWN_FOR ? { kind: c.kind, result: c.result } : null
  }

  /** Stoppages stay news until the restart; anything else for a moment. */
  private recentEvent() {
    const m = this.match
    const e = m.event
    if (!e) return null
    return m.phase === 'stopped' || m.time - e.time < EVENT_SHOWN_FOR ? { kind: e.kind, team: e.team } : null
  }

  private defenderMode(): DefenderMode | null {
    const m = this.match
    return m.phase === 'play' ? (Defender.mode[m.presser] as DefenderMode) : null
  }

  private publishIfChanged() {
    const m = this.match
    const grades = TEAM_NAMES.flatMap((team) => ROLES.flatMap((role) => gradeKeys(role).map((key) => getGrade(m, team, role, key))))
    const challenge = this.recentChallenge()
    const event = this.recentEvent()
    const key = [
      m.phase,
      m.possession,
      event && `${event.kind}:${event.team}:${m.event?.time}`,
      m.restart?.kind,
      ...m.stats.flatMap((s) => Object.values(s)),
      this.defenderMode(),
      this.carrierShielding(),
      challenge && `${challenge.kind}:${challenge.result}:${m.lastChallenge?.time}`,
      ...grades,
      this.overlay,
    ].join('|')
    if (key === this.snapshotKey) return
    this.snapshotKey = key
    this.snapshot = this.takeSnapshot()
    for (const listener of this.listeners) listener()
  }
}

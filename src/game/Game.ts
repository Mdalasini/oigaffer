import { Batch } from '../render/batch'
import { goalCamera, pitchCamera } from '../render/cameras'
import type { Overlay } from '../render/overlay'
import { Renderer } from '../render/renderer'
import { buildScene } from '../render/scene'
import type { ChallengeKind, ChallengeResult } from '../sim/challenge'
import { Defender, DefenderMode, Position, Shield, Team } from '../sim/components'
import { FIXED_DT, OUTFIELDERS_PER_SIDE } from '../sim/constants'
import {
  createMatch,
  getGrade,
  gradeKeys,
  ROLES,
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
import { applyInput, encodeFlag, ticksAt, type Input, type Replay } from '../sim/replay'
import { restoreState, saveState, type SavedState } from '../sim/snapshot'
import { playerLabel } from '../sim/trace'
import { Rewind } from './Rewind'
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
  /** While a moment is being flagged, the stretch that can be looked back over and the part chosen, in steps. */
  flag: FlagView | null
}

export interface FlagView {
  earliest: number
  latest: number
  /** The step being shown. */
  at: number
  from: number
  to: number
  playing: boolean
}

interface Flagging extends FlagView {
  /** The live match as it was when it was paused, to go back to. */
  live: SavedState
}

/** A flag starts out covering the last this many seconds. */
const FLAG_LENGTH = 10

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
  /** The seed and every input so far, so any moment of this match can be played again exactly. */
  private readonly record: Replay
  /** Steps taken since the match was created. */
  private tick = 0
  private readonly rewind: Rewind
  private flagging: Flagging | null = null

  constructor() {
    this.record = { seed: Date.now() >>> 0, outfielders: OUTFIELDERS_PER_SIDE, inputs: [] }
    this.match = createMatch({ seed: this.record.seed, outfielders: this.record.outfielders })
    this.rewind = new Rewind(this.match, this.record)
    this.snapshot = this.takeSnapshot()
  }

  /** The match so far as a replay: its seed and inputs. */
  replay(): Replay {
    return { ...this.record, inputs: [...this.record.inputs] }
  }

  /**
   * Starts drawing into `canvas`; the goal view fills `inset`'s on-screen
   * box, and while flagging, each player's label is placed in `labels`.
   */
  mount(canvas: HTMLCanvasElement, inset: HTMLElement, labels: HTMLElement): () => void {
    const renderer = new Renderer(canvas)
    let raf = 0
    let last = performance.now()
    let accumulator = 0

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      accumulator += dt
      last = now
      while (accumulator >= FIXED_DT) {
        accumulator -= FIXED_DT
        const flag = this.flagging
        if (!flag) {
          stepMatch(this.match, FIXED_DT)
          this.tick++
          this.rewind.stepped(this.tick)
        } else if (flag.playing && flag.at < flag.latest) {
          this.rewind.step(flag.at++)
        } else if (flag.playing) {
          flag.playing = false
        }
      }
      this.render(renderer, canvas, inset)
      this.placeLabels(canvas, labels)
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
    this.input({ tick: this.tick, kind: 'grade', team, role, key, grade })
  }

  /** Shows the space model over the pitch, or hides it. */
  setOverlay(overlay: Overlay) {
    this.overlay = overlay
    this.publishIfChanged()
  }

  shoot() {
    this.input({ tick: this.tick, kind: 'shoot' })
  }

  /** A fresh match: score cleared, red to kick off. */
  reset() {
    this.input({ tick: this.tick, kind: 'reset' })
  }

  /** Pauses the match to flag a moment in its last two minutes. */
  startFlag() {
    if (this.flagging) return
    const latest = this.tick
    const earliest = this.rewind.earliest
    const from = Math.max(earliest, latest - ticksAt(FLAG_LENGTH))
    this.flagging = { live: saveState(this.match), earliest, latest, at: latest, from, to: latest, playing: false }
    this.seek(from)
  }

  /** Shows the match as it was after `tick` steps. */
  seek(tick: number) {
    const flag = this.flagging
    if (!flag) return
    flag.at = Math.round(Math.min(flag.latest, Math.max(flag.earliest, tick)))
    this.rewind.seek(flag.at)
    this.publishIfChanged()
  }

  /** Marks the moment shown as the start or the end of the flagged stretch. */
  markFlag(end: 'from' | 'to') {
    const flag = this.flagging
    if (!flag) return
    flag[end] = flag.at
    if (flag.from > flag.to) [flag.from, flag.to] = [flag.to, flag.from]
    this.publishIfChanged()
  }

  /** Plays the flagged stretch on from the moment shown, or stops it. */
  toggleFlagPlay() {
    const flag = this.flagging
    if (!flag) return
    if (!flag.playing && flag.at >= flag.latest) this.seek(flag.from)
    flag.playing = !flag.playing
    this.publishIfChanged()
  }

  /** The flag as text to paste: the match's seed and inputs, the stretch chosen and a note. */
  flagText(note: string): string {
    const flag = this.flagging
    if (!flag) return ''
    const replay = this.replay()
    return encodeFlag({
      ...replay,
      inputs: replay.inputs.filter((i) => i.tick < flag.to),
      from: flag.from,
      to: flag.to,
      note: note.trim() || undefined,
      check: this.rewind.checkpoint(flag.to),
    })
  }

  /** Puts the live match back as it was when paused, and plays on. */
  endFlag() {
    const flag = this.flagging
    if (!flag) return
    restoreState(this.match, flag.live)
    this.flagging = null
    this.publishIfChanged()
  }

  /** Every change from outside goes through here, so the record misses none. Nothing changes while flagging. */
  private input(input: Input) {
    if (this.flagging) return
    this.record.inputs.push(input)
    applyInput(this.match, input)
    this.publishIfChanged()
  }

  private render(renderer: Renderer, canvas: HTMLCanvasElement, inset: HTMLElement) {
    const dpr = renderer.resize()
    const main = { x: 0, y: 0, width: canvas.width, height: canvas.height }
    const top = pitchCamera(main.width / main.height, this.match.pitch)
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
    return m.shot ? m.shot.goalX : attackedGoalX(m.pitch, Team.id[m.carrier])
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
      flag: this.flagView(),
    }
  }

  private flagView(): FlagView | null {
    const f = this.flagging
    return f && { earliest: f.earliest, latest: f.latest, at: f.at, from: f.from, to: f.to, playing: f.playing }
  }

  /** While flagging, a label over each player, so they can be named in a note. */
  private placeLabels(canvas: HTMLCanvasElement, labels: HTMLElement) {
    labels.hidden = !this.flagging
    if (!this.flagging) return
    const m = this.match
    const players = m.teams.flatMap((t) => [...t.outfielders, t.keeper])
    while (labels.children.length < players.length) labels.append(document.createElement('span'))
    const { width, height } = canvas.getBoundingClientRect()
    const vp = pitchCamera(canvas.width / canvas.height, m.pitch).viewProjection
    players.forEach((eid, i) => {
      const x = Position.x[eid]
      const y = Position.y[eid]
      // The pitch camera is orthographic, so clip space needs no divide.
      const cx = vp[0] * x + vp[4] * y + vp[12]
      const cy = vp[1] * x + vp[5] * y + vp[13]
      const label = labels.children[i] as HTMLElement
      label.textContent = playerLabel(m, eid)
      label.style.left = `${((cx + 1) / 2) * width}px`
      label.style.top = `${((1 - cy) / 2) * height}px`
    })
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
      // While playing a flag back, the panel's clock is shown to a tenth of a second.
      this.flagging && [this.flagging.earliest, this.flagging.latest, Math.round(this.flagging.at / ticksAt(0.1)), this.flagging.from, this.flagging.to, this.flagging.playing].join(','),
    ].join('|')
    if (key === this.snapshotKey) return
    this.snapshotKey = key
    this.snapshot = this.takeSnapshot()
    for (const listener of this.listeners) listener()
  }
}

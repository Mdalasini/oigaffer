import { Position, Team } from './components'
import { FIXED_DT } from './constants'
import type { Cue } from './cues'
import type { Match, PassKind, RestartKind } from './match'
import type { Pitch } from './pitch'
import { along } from './shape'
import { attackedGoalX } from './teams'
import { hypot } from './fmath'

/** A pass struck by an outfielder. Positions are in `team`'s along-terms (u) and y. */
export interface PassAction {
  team: number
  time: number
  fromU: number
  fromY: number
  toU: number
  toY: number
  kind: PassKind
  completed: boolean
}

export interface ShotAction {
  team: number
  time: number
  /** Where the shot was struck from. */
  u: number
  y: number
  /** Ground distance (m) from where it was struck to the middle of the goal attacked. */
  distance: number
  outcome: string
}

/** A spell on the ball: from winning it or a restart until the other team has it. */
export interface PossessionSpell {
  team: number
  start: number
  end: number
  startU: number
  maxU: number
  passes: number
  shot: boolean
}

export interface ActionLog {
  pitch: Pitch
  /** Match time recorded, in minutes. */
  minutes: number
  /** Seconds with the ball in play or a shot on its way. */
  inPlay: number
  passes: PassAction[]
  shots: ShotAction[]
  spells: PossessionSpell[]
  /** Count per team of each restart. */
  restarts: Record<RestartKind, [number, number]>
}

export const METRIC_KEYS = [
  'passes', 'passCompletion', 'passesOwnHalf', 'passesDefThird', 'passesMidThird', 'passesFinalThird',
  'finalThirdEntries', 'boxEntries', 'forwardShare', 'backwardShare', 'progressive', 'avgPassLength', 'longShare', 'crosses',
  'shots', 'goals', 'shotsInBox', 'avgShotDistance', 'onTarget',
  'spells', 'passesPerSpell', 'spellsReachingFinalThird', 'possessionShare', 'fieldTilt', 'ballInPlay',
  'corners', 'throwIns', 'goalKicks',
] as const
export type MetricKey = (typeof METRIC_KEYS)[number]

/** The metrics that are shares, 0 to 1. */
export const SHARE_KEYS: readonly MetricKey[] = [
  'passCompletion', 'passesOwnHalf', 'passesDefThird', 'passesMidThird', 'passesFinalThird', 'forwardShare', 'backwardShare',
  'longShare', 'shotsInBox', 'onTarget', 'spellsReachingFinalThird', 'possessionShare', 'fieldTilt', 'ballInPlay',
]

const SHOT_OUTCOMES: readonly string[] = ['goal', 'caught', 'parried', 'wide', 'over', 'blocked']
const ON_TARGET: readonly string[] = ['goal', 'caught', 'parried']

/**
 * Follows a match through its cues, events and steps, and records each pass,
 * shot, possession spell and restart, and the time the ball is in play. Call
 * `afterStep` after every `stepMatch`, then `finish`. It never changes what
 * happens, and it chains any handlers already set on the world.
 */
export function recordActions(world: Match) {
  const { pitch } = world
  const start = world.time
  const log: ActionLog = {
    pitch,
    minutes: 0,
    inPlay: 0,
    passes: [],
    shots: [],
    spells: [],
    restarts: { 'kick-off': [0, 0], 'throw-in': [0, 0], corner: [0, 0], 'goal-kick': [0, 0], 'free-kick': [0, 0] },
  }

  const newSpell = (team: number): PossessionSpell => {
    const u = along(team, Position.x[world.ball])
    return { team, start: world.time, end: world.time, startU: u, maxU: u, passes: 0, shot: false }
  }
  let spell = newSpell(world.possession)
  log.spells.push(spell)

  // The pass on its way, until it's received or broken up.
  let pending: PassAction | null = null
  const seenCompleted = [world.stats[0].completed, world.stats[1].completed]
  const seenShots = [world.stats[0].shots, world.stats[1].shots]
  let lastShot = world.shot
  let lastRestart = world.restart
  // Each team's shot still waiting for its outcome, and outcomes that came before their shot was counted.
  const openShot: (ShotAction | null)[] = [null, null]
  const unclaimed = new Map<number, string>()

  // A completion counts for the pass on its way: only it can be received, and only in play.
  const syncCompleted = () => {
    for (const t of [0, 1]) {
      const now = world.stats[t].completed
      if (pending?.team === t && now > seenCompleted[t]) {
        pending.completed = true
        pending = null
      }
      seenCompleted[t] = now
    }
  }

  const prevCue = world.onCue
  world.onCue = (c: Cue) => {
    prevCue?.(c)
    if (c.kind === 'passStruck') {
      const team = Team.id[c.passer]
      const pass = world.pass
      // A keeper's roll-out isn't a pass, and isn't counted in the stats either.
      if (!pass || world.teams[team].keeper === c.passer) return
      syncCompleted()
      const fromX = Position.x[world.ball]
      pending = {
        team,
        time: world.time,
        fromU: along(team, fromX),
        fromY: Position.y[world.ball],
        toU: along(team, pass.x),
        toY: pass.y,
        kind: pass.kind,
        completed: false,
      }
      log.passes.push(pending)
      if (spell.team === team) spell.passes++
    } else if (c.kind === 'possession') {
      syncCompleted()
      if (pending && pending.team !== c.team) pending = null
      if (c.team !== spell.team) {
        spell.end = world.time
        spell = newSpell(c.team)
        log.spells.push(spell)
      }
    }
  }

  const prevEvent = world.onEvent
  world.onEvent = (e) => {
    prevEvent?.(e)
    if (!SHOT_OUTCOMES.includes(e.kind)) return
    const open = openShot[e.team]
    if (open) {
      open.outcome = e.kind
      openShot[e.team] = null
    } else unclaimed.set(e.team, e.kind)
  }

  const afterStep = () => {
    syncCompleted()
    // Play stopping or a shot going up means the pass can no longer be received.
    if (world.phase !== 'play') pending = null

    for (const t of [0, 1]) {
      while (seenShots[t] < world.stats[t].shots) {
        seenShots[t]++
        const shot = world.shot
        const fresh = shot && shot !== lastShot && shot.team === t ? shot : null
        let action: ShotAction
        if (fresh) {
          lastShot = fresh
          const { x, y } = fresh.origin
          action = {
            team: t,
            time: world.time,
            u: along(t, x),
            y,
            distance: hypot(x - attackedGoalX(pitch, t), y),
            outcome: unclaimed.get(t) ?? 'pending',
          }
        } else {
          // A goal scored without a shot being struck.
          const x = Position.x[world.ball]
          const y = Position.y[world.ball]
          action = {
            team: t,
            time: world.time,
            u: along(t, x),
            y,
            distance: hypot(x - attackedGoalX(pitch, t), y),
            outcome: 'goal',
          }
        }
        log.shots.push(action)
        if (action.outcome === 'pending') openShot[t] = action
        if (spell.team === t) spell.shot = true
      }
    }

    const inPlay = world.phase === 'play' || world.phase === 'shot'
    // A ball that has gone out keeps rolling until the restart, so only the ball in play counts for how far up it got.
    if (inPlay) spell.maxU = Math.max(spell.maxU, along(spell.team, Position.x[world.ball]))

    const restart = world.restart
    if (restart && restart !== lastRestart) log.restarts[restart.kind][restart.team]++
    lastRestart = restart

    if (inPlay) log.inPlay += FIXED_DT
    unclaimed.clear()
  }

  const finish = (): ActionLog => {
    syncCompleted()
    spell.end = world.time
    log.minutes = (world.time - start) / 60
    return log
  }

  return { log, afterStep, finish }
}

/**
 * Minutes the ball is in play in a typical real 90: stoppages there take far
 * longer than in the sim, so counts are scaled to this much play rather than
 * to 90 minutes of match time, or every rate would read high by the
 * difference. `ballInPlay` shows the difference itself.
 */
export const REAL_MINUTES_IN_PLAY = 56

/**
 * Each team's metrics. Counts are per 90 minutes of a real match: per
 * `REAL_MINUTES_IN_PLAY` minutes of the ball in play. Guards against empty divisions.
 */
export function summarise(log: ActionLog): [Record<MetricKey, number>, Record<MetricKey, number>] {
  const { pitch } = log
  const L = pitch.halfLength
  const third = L / 3
  const per90 = (n: number) => (log.inPlay > 0 ? (n * REAL_MINUTES_IN_PLAY * 60) / log.inPlay : 0)
  const share = (n: number, d: number) => (d > 0 ? n / d : 0)
  const mean = (xs: number[]) => share(xs.reduce((a, b) => a + b, 0), xs.length)
  const inBox = (u: number, y: number) => u > L - pitch.penaltyAreaDepth && Math.abs(y) < pitch.penaltyAreaHalfWidth
  const spellTime = (s: PossessionSpell) => s.end - s.start

  const totalSpellTime = log.spells.reduce((a, s) => a + spellTime(s), 0)
  const finalThirdPasses = [0, 1].map((t) => log.passes.filter((p) => p.team === t && p.fromU > third).length)
  const allFinalThirdPasses = finalThirdPasses[0] + finalThirdPasses[1]

  const summaryFor = (team: number): Record<MetricKey, number> => {
    const passes = log.passes.filter((p) => p.team === team)
    const done = passes.filter((p) => p.completed)
    const shots = log.shots.filter((s) => s.team === team)
    const spells = log.spells.filter((s) => s.team === team)
    const restarts = (kind: RestartKind) => log.restarts[kind][team]
    const n = passes.length
    const lengths = passes.map((p) => hypot(p.toU - p.fromU, p.toY - p.fromY))
    const ownSpellTime = spells.reduce((a, s) => a + spellTime(s), 0)

    return {
      passes: per90(n),
      passCompletion: share(done.length, n),
      passesOwnHalf: share(passes.filter((p) => p.fromU < 0).length, n),
      passesDefThird: share(passes.filter((p) => p.fromU < -third).length, n),
      passesMidThird: share(passes.filter((p) => p.fromU >= -third && p.fromU <= third).length, n),
      passesFinalThird: share(passes.filter((p) => p.fromU > third).length, n),
      finalThirdEntries: per90(done.filter((p) => p.fromU <= third && p.toU > third).length),
      boxEntries: per90(done.filter((p) => inBox(p.toU, p.toY) && !inBox(p.fromU, p.fromY)).length),
      forwardShare: share(passes.filter((p) => p.toU - p.fromU >= 2).length, n),
      backwardShare: share(passes.filter((p) => p.toU - p.fromU <= -2).length, n),
      // Completed, cutting at least a quarter off the distance to the goal line, from outside their own deep end.
      progressive: per90(done.filter((p) => L - p.toU <= 0.75 * (L - p.fromU) && p.fromU > -L / 2).length),
      avgPassLength: mean(lengths),
      longShare: share(lengths.filter((d) => d > 27).length, n),
      crosses: per90(passes.filter((p) => p.fromU > third && Math.abs(p.fromY) > pitch.penaltyAreaHalfWidth && inBox(p.toU, p.toY)).length),
      shots: per90(shots.length),
      goals: per90(shots.filter((s) => s.outcome === 'goal').length),
      shotsInBox: share(shots.filter((s) => inBox(s.u, s.y)).length, shots.length),
      avgShotDistance: mean(shots.map((s) => s.distance)),
      onTarget: share(shots.filter((s) => ON_TARGET.includes(s.outcome)).length, shots.length),
      spells: per90(spells.length),
      passesPerSpell: mean(spells.map((s) => s.passes)),
      spellsReachingFinalThird: share(spells.filter((s) => s.maxU > third).length, spells.length),
      possessionShare: share(ownSpellTime, totalSpellTime),
      fieldTilt: share(finalThirdPasses[team], allFinalThirdPasses),
      ballInPlay: share(log.inPlay, log.minutes * 60),
      corners: per90(restarts('corner')),
      throwIns: per90(restarts('throw-in')),
      goalKicks: per90(restarts('goal-kick')),
    }
  }
  return [summaryFor(0), summaryFor(1)]
}

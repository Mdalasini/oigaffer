import { hasComponent } from 'bitecs'
import { Call, CallKind, Defender, DefenderMode, Effort, Facing, Goalkeeper, Mark, OffBalance, OffBall, Offside, OnBall, Position, Pressing, Run, RunPhase, Shield, Sliding, Slot, Team, Velocity } from './components'
import type { Cue } from './cues'
import type { Match, MatchEvent } from './match'

/**
 * A match written out as text, for reading what happened without watching
 * it: who is where, how they're moving and what each is doing, moment by
 * moment.
 */

const TEAM_LETTER = ['R', 'B']
const EFFORT_NAME: Record<number, string> = Object.fromEntries(Object.entries(Effort).map(([name, value]) => [value, name.toLowerCase()]))
const DEFENDER_MODE_NAME: Record<number, string> = Object.fromEntries(Object.entries(DefenderMode).map(([name, value]) => [value, name.toLowerCase()]))
const RUN_PHASE_NAME: Record<number, string> = Object.fromEntries(Object.entries(RunPhase).map(([name, value]) => [value, name.toLowerCase()]))
const CALL_NAME: Record<number, string> = Object.fromEntries(Object.entries(CallKind).map(([name, value]) => [value, name.toLowerCase()]))

/** R1–R4 for red's outfielders by slot, RK for red's keeper, and the same with B for blue; '-' for nobody. */
export function playerLabel(world: Match, eid: number): string {
  if (eid < 0) return '-'
  if (eid === world.ball) return 'ball'
  const team = TEAM_LETTER[Team.id[eid]]
  return hasComponent(world, eid, Goalkeeper) ? `${team}K` : `${team}${Slot.index[eid] + 1}`
}

/** Match time as m:ss.s. */
export function clock(seconds: number): string {
  const tenths = Math.round(seconds * 10)
  const m = Math.floor(tenths / 600)
  const s = tenths / 10 - 60 * m
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/** Parses m:ss(.s) or plain seconds. */
export function parseClock(text: string): number {
  const parts = text.split(':').map(Number)
  const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0]
  if (!Number.isFinite(seconds)) throw new Error(`can't read "${text}" as a match time: use m:ss or seconds`)
  return seconds
}

const num = (v: number, width = 5) => v.toFixed(1).padStart(width)
const at = (x: number, y: number) => `(${num(x)},${num(y)})`
const degrees = (radians: number) => `${Math.round((radians * 180) / Math.PI)}°`.padStart(5)

export const TRACE_LEGEND = [
  'Players: R1–R4 are red outfielders by formation slot, RK red’s keeper; B… the same for blue.',
  'Positions are metres from the centre spot: +x is the goal red attacks, +y the left touchline as red attacks.',
  'Facing is degrees from +x, anticlockwise. Speeds are m/s.',
].join('\n')

/** The state of play: phase, who has it, and where the ball is. */
export function describeSituation(world: Match): string {
  const ball = world.ball
  const speed = Math.hypot(Velocity.x[ball], Velocity.y[ball])
  const parts = [`${clock(world.time)}  ${world.phase}`, `${TEAM_LETTER[world.possession]} in possession`]
  if (world.phase === 'play' || world.phase === 'shot') {
    parts.push(`carrier ${playerLabel(world, world.carrier)}`)
    parts.push(`presser ${playerLabel(world, world.presser)} (${DEFENDER_MODE_NAME[Defender.mode[world.presser]]})`)
  }
  if (world.pass) parts.push(`pass ${world.pass.kind} ${playerLabel(world, world.pass.from)}→${playerLabel(world, world.pass.to)} aimed ${at(world.pass.x, world.pass.y).trim()}`)
  if (world.restart) parts.push(`restart ${world.restart.kind} to ${TEAM_LETTER[world.restart.team]}`)
  parts.push(`ball ${at(Position.x[ball], Position.y[ball]).trim()} z ${Position.z[ball].toFixed(1)} at ${speed.toFixed(1)}`)
  return parts.join(' | ')
}

/** One line per player: where they are, how they're moving, and every job and state they have on. */
export function describePlayer(world: Match, eid: number): string {
  const speed = Math.hypot(Velocity.x[eid], Velocity.y[eid])
  const line = [`  ${playerLabel(world, eid).padEnd(3)} ${at(Position.x[eid], Position.y[eid])} ${num(speed, 4)} facing ${degrees(Facing.angle[eid])}`]
  if (hasComponent(world, eid, Goalkeeper)) return line.join('')
  const jobs: string[] = []
  if (hasComponent(world, eid, OnBall)) jobs.push(Shield.active[eid] ? 'on the ball, shielding' : 'on the ball')
  if (hasComponent(world, eid, Pressing)) jobs.push(`pressing (${DEFENDER_MODE_NAME[Defender.mode[eid]]})`)
  if (hasComponent(world, eid, Sliding)) jobs.push('on the ground')
  if (OffBalance.timer[eid] > 0) jobs.push(`off balance ${OffBalance.timer[eid].toFixed(1)}s`)
  if (!hasComponent(world, eid, OnBall) && !hasComponent(world, eid, Pressing)) {
    jobs.push(`heading for ${at(OffBall.targetX[eid], OffBall.targetY[eid]).trim()} at a ${EFFORT_NAME[OffBall.effort[eid]]}${OffBall.settled[eid] ? ', settled' : ''}`)
  }
  if (Mark.target[eid] >= 0) jobs.push(`marking ${playerLabel(world, Mark.target[eid])}${Mark.cover[eid] ? ' (cover)' : ''}`)
  if (Run.phase[eid] !== RunPhase.None) jobs.push(`run ${RUN_PHASE_NAME[Run.phase[eid]]} to ${at(Run.targetX[eid], Run.targetY[eid]).trim()}`)
  if (Call.kind[eid] !== CallKind.None) jobs.push(`calling for ${CALL_NAME[Call.kind[eid]]}`)
  if (Offside.flagged[eid]) jobs.push('offside')
  return `${line.join('')} | ${jobs.join('; ')}`
}

/** Every player, red then blue, outfielders then keeper. */
export function describePlayers(world: Match, only?: Set<string>): string[] {
  const players = world.teams.flatMap((t) => [...t.outfielders, t.keeper])
  return players.filter((eid) => !only || only.has(playerLabel(world, eid))).map((eid) => describePlayer(world, eid))
}

/** A cue as a line of text. */
export function describeCue(world: Match, c: Cue): string {
  const p = (eid: number) => playerLabel(world, eid)
  switch (c.kind) {
    case 'possession': return `possession to ${TEAM_LETTER[c.team]}`
    case 'carrier': return `${p(c.player)} on the ball (from ${p(c.previous)})`
    case 'presser': return `${p(c.player)} engages the ball (from ${p(c.previous)})`
    case 'held': return `${p(c.keeper)} holds the ball`
    case 'passStruck': return `pass struck ${p(c.passer)}→${p(c.receiver)}`
    case 'run': return `${p(c.runner)} makes a run in behind`
    case 'passShaped': return `${p(c.passer)} shapes to pass ${c.option.kind} to ${p(c.option.receiver)} in ${c.windup.toFixed(2)}s (safety ${c.option.safety.toFixed(2)}, value ${c.option.value.toFixed(3)})`
    case 'passCalledOff': return `pass to ${p(c.option.receiver)} called off`
    case 'trap': return `${TEAM_LETTER[c.team]} steps up for the offside trap`
  }
}

export function describeEvent(event: MatchEvent): string {
  return `${event.kind} (${TEAM_LETTER[event.team]})`
}

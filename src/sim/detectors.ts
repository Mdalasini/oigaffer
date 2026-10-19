import { hasComponent } from 'bitecs'
import { DefenderMode, Defender, Mark, OffBalance, Position, Sliding, Team, Velocity } from './components'
import type { Match } from './match'
import { ownGoalX } from './teams'
import { playerLabel } from './trace'
import { atan2, cos, hypot, sin } from './fmath'

/**
 * Detectors for behaviour that looks wrong to someone watching: each spots
 * one kind of oddity in a running match, so a fix can be measured (how often
 * it happens per 90 minutes, over many matches) rather than judged from one
 * clip, and the cases left can be found and read back with `inspect`.
 *
 * They look at the match as it really is, not as players perceive it, and
 * never change it.
 */
export interface Detector {
  name: string
  /** What it looks for, in a line. */
  about: string
  /** Seconds an oddity has to last before it counts. */
  lasting: number
  /** The oddities showing now, keyed so the same one can be followed from one look to the next. */
  look(world: Match): Map<string, Sighting>
}

export interface Sighting {
  players: number[]
  detail: string
}

/** One oddity, from when it was first seen to when it stopped, in match seconds. */
export interface Finding extends Sighting {
  detector: string
  from: number
  to: number
}

/** Detectors look this often (s). */
export const LOOK_EVERY = 0.1

const speed = (eid: number) => hypot(Velocity.x[eid], Velocity.y[eid])
const distance = (a: number, b: number) => hypot(Position.x[a] - Position.x[b], Position.y[a] - Position.y[b])
const down = (world: Match, eid: number) => hasComponent(world, eid, Sliding) || OffBalance.timer[eid] > 0
/** The outfielders not on the ball and not pressing it. */
const offBall = (world: Match, team: number) => world.teams[team].outfielders.filter((eid) => eid !== world.carrier && eid !== world.presser)
const names = (world: Match, players: number[]) => players.map((eid) => playerLabel(world, eid)).join(', ')

/** A loose ball is one off everyone's feet with no pass on its way. */
const LOOSE_FROM = 2.5
/**
 * Chasing it: running at it at least this fast (m/s), within this angle
 * (rad) of straight at it, and closing on it at least this fast, from within
 * this far (m).
 */
const CHASE_RUNNING = 2
const CHASE_ANGLE = 0.5
const CHASE_CLOSING = 3
const CHASE_RANGE = 20

/** Two or more of a team running at the same loose ball, besides their cover: one should go, the rest hold. */
function doubleChase(): Detector {
  return {
    name: 'doubleChase',
    about: 'two or more teammates chasing the same loose ball',
    lasting: 1,
    look(world) {
      const found = new Map<string, Sighting>()
      const ball = world.ball
      if (world.phase !== 'play' || world.pass || distance(ball, world.carrier) < LOOSE_FROM) return found
      for (const team of [0, 1]) {
        const chasing = world.teams[team].outfielders.filter((eid) => {
          const dx = Position.x[ball] - Position.x[eid]
          const dy = Position.y[ball] - Position.y[eid]
          const d = hypot(dx, dy)
          // The cover runs to his spot behind the ball, often along its path: that's his job, not a chase.
          if (down(world, eid) || d > CHASE_RANGE || Mark.cover[eid]) return false
          // Their own run at it, and how fast the gap is shrinking with the ball's movement counted too.
          const running = (Velocity.x[eid] * dx + Velocity.y[eid] * dy) / d
          const closing = running - (Velocity.x[ball] * dx + Velocity.y[ball] * dy) / d
          const straightAt = running >= speed(eid) * cos(CHASE_ANGLE)
          return running >= CHASE_RUNNING && straightAt && closing >= CHASE_CLOSING
        })
        if (chasing.length >= 2) found.set(`${team}`, { players: chasing, detail: `${names(world, chasing)} all running at the loose ball` })
      }
      return found
    },
  }
}

/**
 * Movement is measured in legs this long (s), so a moment's shuffle or a
 * sidestep doesn't count. A leg covering this much ground (m) is going
 * somewhere; one heading more than this far round (rad) from the leg before
 * is a reversal: going back the way they came.
 */
const LEG = 0.5
const LEG_GROUND = 1
const REVERSAL = (2 * Math.PI) / 3
/** This many reversals within this many seconds is dithering. */
const DITHER_REVERSALS = 2
const DITHER_WINDOW = 4

/** An off-ball player going back and forth: changing their mind about where to go. */
function dithering(): Detector {
  // Each player's position at the start of their current leg, the way their last leg went, and when they reversed.
  const legStart = new Map<number, { time: number; x: number; y: number }>()
  const lastLeg = new Map<number, number | null>()
  const reversals = new Map<number, number[]>()
  return {
    name: 'dithering',
    about: `an off-ball player going back the way they came ${DITHER_REVERSALS}+ times in ${DITHER_WINDOW} s, measured over ${LEG} s legs`,
    lasting: 0,
    look(world) {
      const found = new Map<string, Sighting>()
      for (const team of [0, 1]) {
        for (const eid of world.teams[team].outfielders) {
          const turned = reversals.get(eid) ?? []
          reversals.set(eid, turned)
          while (turned.length && turned[0] < world.time - DITHER_WINDOW) turned.shift()
          if (world.phase !== 'play' || eid === world.carrier || eid === world.presser || down(world, eid)) {
            legStart.delete(eid)
            lastLeg.set(eid, null)
            turned.length = 0
            continue
          }
          const start = legStart.get(eid)
          if (!start) legStart.set(eid, { time: world.time, x: Position.x[eid], y: Position.y[eid] })
          else if (world.time - start.time >= LEG - 1e-6) {
            const dx = Position.x[eid] - start.x
            const dy = Position.y[eid] - start.y
            legStart.set(eid, { time: world.time, x: Position.x[eid], y: Position.y[eid] })
            // A leg that went nowhere doesn't set a direction, but doesn't break the run of legs either.
            if (hypot(dx, dy) >= LEG_GROUND) {
              const angle = atan2(dy, dx)
              const before = lastLeg.get(eid)
              if (before != null && Math.abs(atan2(sin(angle - before), cos(angle - before))) > REVERSAL) turned.push(world.time)
              lastLeg.set(eid, angle)
            }
          }
          if (turned.length >= DITHER_REVERSALS) found.set(`${eid}`, { players: [eid], detail: `${playerLabel(world, eid)} went back the way they came ${turned.length} times in ${DITHER_WINDOW} s` })
        }
      }
      return found
    },
  }
}

/** A marker this far (m) from their man, with him this much nearer their goal (m), has lost him. */
const LOST_DISTANCE = 5
const LOST_BEHIND = 2

/** A defender whose man is in their half and goal-side of them, well away from them. */
function lostMan(): Detector {
  return {
    name: 'lostMan',
    about: `a marker ${LOST_DISTANCE}+ m from their man, who is in their half and ${LOST_BEHIND}+ m nearer their goal`,
    lasting: 1.5,
    look(world) {
      const found = new Map<string, Sighting>()
      if (world.phase !== 'play') return found
      const team = 1 - world.possession
      const goalX = ownGoalX(world.pitch, team)
      for (const eid of offBall(world, team)) {
        const man = Mark.target[eid]
        if (man === -1 || Mark.cover[eid] || man === world.carrier || down(world, eid)) continue
        const toGoal = (p: number) => hypot(goalX - Position.x[p], Position.y[p])
        const gap = distance(eid, man)
        if (toGoal(man) > world.pitch.halfLength || toGoal(eid) - toGoal(man) < LOST_BEHIND || gap < LOST_DISTANCE) continue
        found.set(`${eid}`, { players: [eid, man], detail: `${playerLabel(world, eid)} ${gap.toFixed(1)} m off ${playerLabel(world, man)}, who is goal-side of them` })
      }
      return found
    },
  }
}

/** The presser standing (under this speed, m/s) this far (m) or more off the ball. */
const IDLE_SPEED = 1
const IDLE_FROM = 3

/** The player meant to be engaging the ball, standing off it instead. */
function idlePresser(): Detector {
  return {
    name: 'idlePresser',
    about: `the presser standing still ${IDLE_FROM}+ m off the ball`,
    lasting: 1,
    look(world) {
      const found = new Map<string, Sighting>()
      const p = world.presser
      if (world.phase !== 'play' || down(world, p)) return found
      const mode = Defender.mode[p]
      if ((mode !== DefenderMode.Jockey && mode !== DefenderMode.Run) || speed(p) >= IDLE_SPEED) return found
      const gap = distance(p, world.ball)
      if (gap >= IDLE_FROM) found.set(`${p}`, { players: [p, world.carrier], detail: `${playerLabel(world, p)} standing ${gap.toFixed(1)} m off the ball` })
      return found
    },
  }
}

/** The carrier running the ball out of play off their own touch. */
function dribbledOut(): Detector {
  return {
    name: 'dribbledOut',
    about: 'a carrier knocking the ball out of play with their own touch',
    lasting: 0,
    look(world) {
      const found = new Map<string, Sighting>()
      const { event, lastTouch } = world
      if (!event || event.kind !== 'out' || world.time - event.time > LOOK_EVERY || !lastTouch) return found
      if (Team.id[lastTouch.by] === event.team || world.lastTouchedBy !== lastTouch.by) return found
      found.set(`${event.time}`, { players: [lastTouch.by], detail: `${playerLabel(world, lastTouch.by)} touched it out` })
      return found
    },
  }
}

/** Three or more off-ball teammates within this distance (m) of each other. */
const CROWD = 6

/** Teammates crowding one patch of the pitch instead of spreading to offer options or cover. */
function crowding(): Detector {
  return {
    name: 'crowding',
    about: `3+ off-ball teammates all within ${CROWD} m of each other`,
    lasting: 2,
    look(world) {
      const found = new Map<string, Sighting>()
      if (world.phase !== 'play') return found
      for (const team of [0, 1]) {
        const players = offBall(world, team)
        const crowd = crowdIn(players)
        if (crowd) found.set(`${team}:${crowd.join(',')}`, { players: crowd, detail: `${names(world, crowd)} bunched within ${CROWD} m` })
      }
      return found
    },
  }
}

/**
 * Three or more of `players` all within CROWD of each other, if there are:
 * the first such three found, joined by anyone else close to all of them.
 * Ordered by entity, so the same crowd is recognised from look to look.
 */
function crowdIn(players: number[]): number[] | null {
  const close = (p: number, q: number) => distance(p, q) <= CROWD
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      if (!close(players[i], players[j])) continue
      for (let k = j + 1; k < players.length; k++) {
        if (!close(players[i], players[k]) || !close(players[j], players[k])) continue
        const crowd = [players[i], players[j], players[k]]
        for (const p of players) if (!crowd.includes(p) && crowd.every((q) => close(p, q))) crowd.push(p)
        return crowd.sort((x, y) => x - y)
      }
    }
  }
  return null
}

/** A fresh set of every detector, for one match. */
export const createDetectors = (): Detector[] => [doubleChase(), dithering(), lostMan(), idlePresser(), dribbledOut(), crowding()]

/**
 * Watches `world` with `detectors`: call `look` every LOOK_EVERY seconds of
 * play and `finish` at the end. Each oddity is reported once, when it stops,
 * if it lasted long enough.
 */
export function watchFor(world: Match, detectors = createDetectors()) {
  const findings: Finding[] = []
  const open = detectors.map(() => new Map<string, Sighting & { from: number }>())
  const close = (i: number, key: string, at: number) => {
    const o = open[i].get(key)!
    open[i].delete(key)
    if (at - o.from >= detectors[i].lasting) findings.push({ detector: detectors[i].name, from: o.from, to: at, players: o.players, detail: o.detail })
  }
  return {
    detectors,
    findings,
    look() {
      detectors.forEach((d, i) => {
        const now = d.look(world)
        for (const key of [...open[i].keys()]) if (!now.has(key)) close(i, key, world.time)
        for (const [key, s] of now) if (!open[i].has(key)) open[i].set(key, { ...s, from: world.time })
      })
    },
    finish() {
      detectors.forEach((_, i) => {
        for (const key of [...open[i].keys()]) close(i, key, world.time)
      })
    },
  }
}

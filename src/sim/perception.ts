import { Call, CallKind, Facing, Mark, Outfielder, Position, Team, Velocity } from './components'
import { FIXED_DT } from './constants'
import { manCheckRate, preReceiveScanChance, scanRate } from './grades'
import type { Match } from './match'

/**
 * What each player knows of the others. Decisions read this, not the truth:
 * physics and the referee use where everyone really is, but a player chooses
 * from where they last saw each teammate and opponent, carried on the way
 * they were going.
 *
 * Knowledge comes in three ways:
 * - **Sight**: anyone in front of them, within the 120° they attend to, is
 *   kept up to date. Outside it, and behind them, it goes stale.
 * - **Scans**: a look over the shoulder takes in everyone at once. Players
 *   with more vision scan more often, and before a pass reaches them.
 * - **Checks**: a marker glances at their man between scans, the more often
 *   the better their positioning. A man who slips behind a marker who rarely
 *   checks is gone before they know it.
 * - **Hearing**: a teammate calling for it is heard wherever they are, and
 *   so is one shouting "man on" about an opponent closing in unseen.
 *
 * A team also pools what its players have seen, as defenders talking to each
 * other do, to share out its marking (see `teamView`).
 *
 * The ball is always known: everyone follows it.
 */
export interface Memory {
  /** Every player, outfielders then keepers; a player's place here is their row and column below. */
  players: number[]
  /** Each entity's place in `players`, or -1. */
  index: Int32Array
  /** For observer i and subject j, at i × players + j: where j was, how they were moving and facing, and when i saw it. */
  x: Float64Array
  y: Float64Array
  vx: Float64Array
  vy: Float64Array
  facing: Float64Array
  at: Float64Array
  /** When each player next looks over their shoulder, and when they last did. */
  nextScan: Float64Array
  lastScan: Float64Array
  /** When each player next checks where their man is. */
  nextCheck: Float64Array
}

/**
 * A player takes in others within this angle (rad) either side of where they
 * face, 120° in all: the field they attend to, narrower than what the eye can
 * catch at its edges. A wider field left scanning, and so vision, making
 * next to no difference to how a team played.
 */
export const FIELD_OF_VIEW = 1.05
/** Seen ones are kept up to date this many times a second, each player at their own moments. */
const GLANCES_PER_SECOND = 10
/** Someone not seen for this long (s) is assumed to have kept going this long, then stopped. */
const PROJECT_FOR = 1
/** Someone not seen for this long (s) has slipped their mind as an option. */
const FORGET_AFTER = 4
/** A teammate shouts "man on" about an opponent within this distance (m) of the player on the ball or about to get it... */
const MAN_ON_RANGE = 5
/** ...whom that player hasn't seen for this long (s)... */
const MAN_ON_UNSEEN = 0.5
/**
 * ...at this rate (per second) while it lasts: it takes a teammate a moment
 * to notice and shout, and the shout doesn't always come before the tackle.
 */
const MAN_ON_RATE = 1.5
/** Before a pass reaches them, a player who scans does it this long (s) after it's struck. */
const SCAN_BEFORE_RECEIVING = 0.15

const GLANCE_TICKS = Math.round(1 / (GLANCES_PER_SECOND * FIXED_DT))
const COS_FIELD_OF_VIEW = Math.cos(FIELD_OF_VIEW)

/** Empty memories for `players`: nobody has seen anybody yet. */
export function createMemory(players: number[], maxEntities: number): Memory {
  const n = players.length
  const index = new Int32Array(maxEntities).fill(-1)
  players.forEach((eid, i) => (index[eid] = i))
  const pairs = () => new Float64Array(n * n)
  return {
    players,
    index,
    x: pairs(),
    y: pairs(),
    vx: pairs(),
    vy: pairs(),
    facing: pairs(),
    at: pairs().fill(-Infinity),
    nextScan: new Float64Array(n),
    lastScan: new Float64Array(n).fill(-Infinity),
    nextCheck: new Float64Array(n),
  }
}

/**
 * Keeps every outfielder's knowledge up to date: glancing at what's in front
 * of them, scanning when it's time, and hearing teammates call. Keepers
 * don't read it, so they don't keep one.
 */
export function perceptionSystem(world: Match, _dt: number) {
  const memory = world.memory
  const tick = Math.round(world.time / FIXED_DT)
  for (const team of [0, 1]) {
    for (const eid of world.teams[team].outfielders) {
      const i = memory.index[eid]
      if (world.time >= memory.nextScan[i]) scan(world, eid)
      else if ((tick + i) % GLANCE_TICKS === 0) glance(world, eid)
      if (world.time >= memory.nextCheck[i]) checkMan(world, eid)
    }
  }
  if (world.phase === 'play') manOn(world, world.carrier)
}

/**
 * "Man on!": an opponent closing in on `player` that they haven't seen, but
 * a teammate has, is shouted about, and they know he's there.
 */
function manOn(world: Match, player: number) {
  const memory = world.memory
  const n = memory.players.length
  const team = Team.id[player]
  const i = memory.index[player]
  for (const opponent of world.teams[1 - team].outfielders) {
    const k = i * n + memory.index[opponent]
    if (world.time - memory.at[k] < MAN_ON_UNSEEN) continue
    if (Math.hypot(Position.x[opponent] - Position.x[player], Position.y[opponent] - Position.y[player]) > MAN_ON_RANGE) continue
    // A teammate who has just seen him, and so has him in view, may shout.
    let spotted = false
    for (const mate of world.teams[team].outfielders) {
      if (mate !== player && world.time - memory.at[memory.index[mate] * n + memory.index[opponent]] < FIXED_DT * GLANCE_TICKS) spotted = true
    }
    if (spotted && world.rng() < MAN_ON_RATE * FIXED_DT) {
      see(world, player, opponent)
      world.manOnShouts++
    }
  }
}

/** Takes in everyone in front of `observer`, and any teammate calling for it. */
function glance(world: Match, observer: number) {
  const memory = world.memory
  const fx = Math.cos(Facing.angle[observer])
  const fy = Math.sin(Facing.angle[observer])
  const ox = Position.x[observer]
  const oy = Position.y[observer]
  for (const subject of memory.players) {
    if (subject === observer) continue
    const dx = Position.x[subject] - ox
    const dy = Position.y[subject] - oy
    const distance = Math.sqrt(dx * dx + dy * dy)
    const inView = dx * fx + dy * fy >= COS_FIELD_OF_VIEW * distance
    const heard = Team.id[subject] === Team.id[observer] && Call.kind[subject] !== CallKind.None
    if (inView || heard) see(world, observer, subject)
  }
}

/** A look over the shoulder: `observer` takes in everyone, and decides when to look again. */
export function scan(world: Match, observer: number) {
  const memory = world.memory
  for (const subject of memory.players) if (subject !== observer) see(world, observer, subject)
  const i = memory.index[observer]
  memory.lastScan[i] = world.time
  // Scans come at random moments, at a rate set by their vision.
  memory.nextScan[i] = world.time - Math.log(1 - world.rng()) / scanRate(Outfielder.vision[observer])
}

/** A glance at their man, wherever he is: `observer` sees him, and decides when to check again. */
function checkMan(world: Match, observer: number) {
  const man = Mark.target[observer]
  if (man !== -1) see(world, observer, man)
  const i = world.memory.index[observer]
  // Like scans, checks come at random moments, at a rate set by their positioning.
  world.memory.nextCheck[i] = world.time - Math.log(1 - world.rng()) / manCheckRate(Outfielder.positioning[observer])
}

/** Everyone takes in everyone: at a restart, before play resumes, players have had a look around. */
export function lookAround(world: Match) {
  for (const team of [0, 1]) for (const eid of world.teams[team].outfielders) scan(world, eid)
}

/** A pass is on its way to `receiver`: the better their vision, the likelier they check over their shoulder before it arrives. */
export function maybeScanBeforeReceiving(world: Match, receiver: number) {
  const i = world.memory.index[receiver]
  if (i === -1 || world.rng() >= preReceiveScanChance(Outfielder.vision[receiver])) return
  world.memory.nextScan[i] = Math.min(world.memory.nextScan[i], world.time + SCAN_BEFORE_RECEIVING)
}

function see(world: Match, observer: number, subject: number) {
  const memory = world.memory
  const k = memory.index[observer] * memory.players.length + memory.index[subject]
  memory.x[k] = Position.x[subject]
  memory.y[k] = Position.y[subject]
  memory.vx[k] = Velocity.x[subject]
  memory.vy[k] = Velocity.y[subject]
  memory.facing[k] = Facing.angle[subject]
  memory.at[k] = world.time
}

/**
 * The slot holding what `by` knows of `eid`, or -1 to use the truth: for
 * nobody in particular (-1), for themselves, or for anyone without a memory.
 */
function slot(world: Match, by: number, eid: number): number {
  if (by === -1 || by === eid) return -1
  const memory = world.memory
  const i = memory.index[by]
  const j = memory.index[eid]
  return i === -1 || j === -1 ? -1 : i * memory.players.length + j
}

/** How long (s) `by` has been projecting `eid` on from where they last saw them. */
function projected(world: Match, k: number): number {
  return Math.min(PROJECT_FOR, world.time - world.memory.at[k])
}

/** How one player sees another: where they are, how they're moving and which way they face. */
export interface View {
  x: number
  y: number
  vx: number
  vy: number
  facing: number
}

/** Fills `out` with how `by` sees `eid` now, all at once; the same as the `seen…` functions. */
export function view(world: Match, by: number, eid: number, out: View): View {
  const k = slot(world, by, eid)
  if (k === -1) {
    out.x = Position.x[eid]
    out.y = Position.y[eid]
    out.vx = Velocity.x[eid]
    out.vy = Velocity.y[eid]
    out.facing = Facing.angle[eid]
    return out
  }
  const memory = world.memory
  const age = world.time - memory.at[k]
  const ahead = Math.min(PROJECT_FOR, age)
  out.x = memory.x[k] + memory.vx[k] * ahead
  out.y = memory.y[k] + memory.vy[k] * ahead
  out.vx = age > PROJECT_FOR ? 0 : memory.vx[k]
  out.vy = age > PROJECT_FOR ? 0 : memory.vy[k]
  out.facing = memory.facing[k]
  return out
}

/** Where `by` reckons `eid` is now, across the pitch. */
export function seenX(world: Match, by: number, eid: number): number {
  const k = slot(world, by, eid)
  return k === -1 ? Position.x[eid] : world.memory.x[k] + world.memory.vx[k] * projected(world, k)
}

/** Where `by` reckons `eid` is now, along the pitch. */
export function seenY(world: Match, by: number, eid: number): number {
  const k = slot(world, by, eid)
  return k === -1 ? Position.y[eid] : world.memory.y[k] + world.memory.vy[k] * projected(world, k)
}

/** How `by` reckons `eid` is moving: as they last saw, or standing still once they've stopped projecting. */
export function seenVx(world: Match, by: number, eid: number): number {
  const k = slot(world, by, eid)
  return k === -1 ? Velocity.x[eid] : world.time - world.memory.at[k] > PROJECT_FOR ? 0 : world.memory.vx[k]
}

export function seenVy(world: Match, by: number, eid: number): number {
  const k = slot(world, by, eid)
  return k === -1 ? Velocity.y[eid] : world.time - world.memory.at[k] > PROJECT_FOR ? 0 : world.memory.vy[k]
}

/** Which way `by` reckons `eid` is facing. */
export function seenFacing(world: Match, by: number, eid: number): number {
  const k = slot(world, by, eid)
  return k === -1 ? Facing.angle[eid] : world.memory.facing[k]
}

/** Whether `by` has `eid` in mind: seen or heard recently enough to think of. */
export function knows(world: Match, by: number, eid: number): boolean {
  const k = slot(world, by, eid)
  return k === -1 || world.time - world.memory.at[k] < FORGET_AFTER
}

/**
 * Fills `out` with how `team` sees `eid` between them: from whichever of its
 * outfielders saw them most recently. Its own players it knows exactly.
 */
export function teamView(world: Match, team: number, eid: number, out: View): View {
  if (Team.id[eid] === team) return view(world, -1, eid, out)
  const memory = world.memory
  const n = memory.players.length
  const j = memory.index[eid]
  let freshest = -1
  let at = -Infinity
  for (const mate of world.teams[team].outfielders) {
    const seen = memory.at[memory.index[mate] * n + j]
    if (seen > at) {
      at = seen
      freshest = mate
    }
  }
  return view(world, freshest, eid, out)
}

/** Whether `by` has `eid` in sight right now: seen within the last glance. */
export function inSight(world: Match, by: number, eid: number): boolean {
  const k = slot(world, by, eid)
  return k === -1 || world.time - world.memory.at[k] <= FIXED_DT * GLANCE_TICKS
}

/** Seconds since `eid` last looked over their shoulder. */
export function sinceScan(world: Match, eid: number): number {
  const i = world.memory.index[eid]
  return i === -1 ? Infinity : world.time - world.memory.lastScan[i]
}

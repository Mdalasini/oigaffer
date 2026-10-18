import { removeComponent } from 'bitecs'
import { angleDelta } from './angles'
import { Body, Defender, DefenderMode, Dribbler, Facing, OffBalance, Outfielder, Physical, Position, Shield, Sliding, Team, Velocity } from './components'
import { bargeWinChance, tackleSkill } from './grades'
import { winBall, type Match } from './match'
import { gaussian } from './rng'
import { footDistance } from './touch'

export type ChallengeKind = 'stand' | 'slide' | 'barge'
/** won: defender has the ball. poked: knocked loose. missed: didn't get it. held: carrier rode it out. */
export type ChallengeResult = 'won' | 'poked' | 'missed' | 'held'

export interface LastChallenge {
  kind: ChallengeKind
  result: ChallengeResult
  time: number
}

/** How far (m) from the defender's centre a standing tackle reaches, within STAND_CONE (rad) of facing. */
export const STAND_REACH = 1.25
export const STAND_CONE = 1
/** How far (m) from the body a sliding defender's boot reaches, and how close it must come to the ball. */
export const SLIDE_FOOT = 1
const SLIDE_CONTACT = 0.45
/** A ball this far (m) from the carrier's feet is between touches and easy to nick. */
export const EXPOSED_DISTANCE = 0.7

/** Share of successful challenges that come away with the ball cleanly, rather than poking it loose. */
const CLEAN_WIN_SHARE: Record<ChallengeKind, number> = { stand: 0.6, slide: 0.3, barge: 0 }
/** Tackling through the carrier's body rarely gets the ball. */
const THROUGH_THE_BODY = 0.3

/** Whether the carrier's body sits between the defender and the ball. */
export function bodyBetween(carrier: number, defender: number, ball: number): boolean {
  const ax = Position.x[defender]
  const ay = Position.y[defender]
  const dx = Position.x[ball] - ax
  const dy = Position.y[ball] - ay
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return false
  const t = ((Position.x[carrier] - ax) * dx + (Position.y[carrier] - ay) * dy) / lengthSq
  if (t <= 0 || t >= 1) return false
  const px = ax + dx * t - Position.x[carrier]
  const py = ay + dy * t - Position.y[carrier]
  return Math.hypot(px, py) < Body.radius[carrier] + 0.1
}

/** A standing tackle meets the ball: it may win it, poke it loose, or miss. */
export function resolveStandingTackle(world: Match, defender: number) {
  const { ball, striker } = world
  const dx = Position.x[ball] - Position.x[defender]
  const dy = Position.y[ball] - Position.y[defender]
  const facingGap = Math.abs(angleDelta(Facing.angle[defender], Math.atan2(dy, dx)))
  if (Math.hypot(dx, dy) > STAND_REACH || facingGap > STAND_CONE) {
    stumble(defender, 0.35)
    return record(world, 'stand', 'missed')
  }
  // A ball right at the carrier's feet is much harder to take than one between touches.
  const exposure = Math.min(1, Math.max(0.25, footDistance(striker, ball) / 0.9))
  const shielded = bodyBetween(striker, defender, ball)
  const chance = tackleSkill(Outfielder.tackling[defender], Outfielder.dribbling[striker]) * exposure * (shielded ? THROUGH_THE_BODY : 1)
  settle(world, defender, 'stand', chance, shielded)
}

/** A slide reaches the ball. */
export function resolveSlideTackle(world: Match, defender: number) {
  const { ball, striker } = world
  const shielded = bodyBetween(striker, defender, ball)
  const chance = tackleSkill(Outfielder.tackling[defender], Outfielder.dribbling[striker]) * 0.9 * (shielded ? THROUGH_THE_BODY : 1)
  settle(world, defender, 'slide', chance, shielded)
}

/** Shoulder to shoulder: the stronger player usually keeps their feet. */
export function resolveBarge(world: Match, defender: number) {
  const { striker, rng } = world
  const nx = Position.x[striker] - Position.x[defender]
  const ny = Position.y[striker] - Position.y[defender]
  const len = Math.hypot(nx, ny) || 1
  // A carrier braced to shield is a little harder to move.
  const chance = bargeWinChance(Physical.strength[defender], Physical.strength[striker]) - (Shield.active[striker] ? 0.1 : 0)
  if (rng() < chance) {
    shove(striker, nx / len, ny / len, 2.5)
    stumble(striker, 0.7)
    record(world, 'barge', 'won')
  } else {
    shove(defender, -nx / len, -ny / len, 1.5)
    stumble(defender, 0.5)
    record(world, 'barge', 'held')
  }
}

/** Where a sliding defender's boot is. */
export function slideFoot(defender: number) {
  return {
    x: Position.x[defender] + Defender.actionDirX[defender] * SLIDE_FOOT,
    y: Position.y[defender] + Defender.actionDirY[defender] * SLIDE_FOOT,
  }
}

export function slideReachesBall(world: Match, defender: number) {
  const foot = slideFoot(defender)
  const ball = world.ball
  return Position.z[ball] < 0.5 && Math.hypot(Position.x[ball] - foot.x, Position.y[ball] - foot.y) <= SLIDE_CONTACT
}

/** Back on their feet after a slide. */
export function getUp(world: Match, defender: number) {
  removeComponent(world, defender, Sliding)
  Defender.mode[defender] = DefenderMode.Run
  Defender.actionTime[defender] = 0
}

function settle(world: Match, defender: number, kind: ChallengeKind, chance: number, shielded: boolean) {
  const roll = world.rng()
  if (roll < chance * CLEAN_WIN_SHARE[kind]) {
    Velocity.x[world.ball] = Velocity.x[defender]
    Velocity.y[world.ball] = Velocity.y[defender]
    record(world, kind, 'won')
    winBall(world, Team.id[defender], 'tackled')
  } else if (roll < chance) {
    pokeAway(world, defender)
    record(world, kind, 'poked')
  } else {
    if (kind === 'stand') stumble(defender, 0.35)
    record(world, kind, shielded ? 'held' : 'missed')
  }
}

/** The ball is knocked on, away from the tackler's boot, roughly where it was already headed. */
function pokeAway(world: Match, defender: number) {
  const { ball, rng } = world
  const angle = Math.atan2(Position.y[ball] - Position.y[defender], Position.x[ball] - Position.x[defender]) + gaussian(rng) * 0.6
  const speed = 4 + rng() * 4
  Velocity.x[ball] = Math.cos(angle) * speed
  Velocity.y[ball] = Math.sin(angle) * speed
  Velocity.z[ball] = 1
  world.lastTouchedBy = defender
  world.lastTouchDeliberate = false
  // The carrier can't instantly play a ball that's just been knocked off them.
  Dribbler.cooldown[world.striker] = Math.max(Dribbler.cooldown[world.striker], 0.25)
}

function stumble(eid: number, seconds: number) {
  OffBalance.timer[eid] = Math.max(OffBalance.timer[eid], seconds)
}

function shove(eid: number, nx: number, ny: number, speed: number) {
  Velocity.x[eid] += nx * speed
  Velocity.y[eid] += ny * speed
}

function record(world: Match, kind: ChallengeKind, result: ChallengeResult) {
  world.lastChallenge = { kind, result, time: world.time }
}

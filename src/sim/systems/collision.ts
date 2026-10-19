import { hasComponent, query } from 'bitecs'
import { Body, Outfielder, Position, Sliding, Team, Velocity } from '../components'
import { BALL_RADIUS } from '../constants'
import { endShot, type Match } from '../match'
import { offsideOffence } from '../offside'
import { hypot } from '../fmath'

/** Share of the ball's speed into a body that it keeps when it bounces off. */
const BODY_RESTITUTION = 0.3
/** Legs and hips present a narrower target than the shoulders. */
export const LEG_WIDTH = 0.8
/** How far (m) beyond their legs a defender stretches a leg out to block a shot, and how high (m) it reaches. */
const BLOCK_STRETCH = 0.8
const BLOCK_HEIGHT = 0.9
/** Height (m) of a player lying on the ground, sliding or getting up. */
const PRONE_HEIGHT = 0.4
/** Seconds a pass takes to get clear of the passer's body. */
const PASSER_CLEARANCE = 0.3
/** Separating one pair can push a body into another, so repeat until settled. */
const MAX_PASSES = 8
const TOLERANCE = 1e-4

/** Players can't pass through each other. */
export function collisionSystem(world: Match, _dt: number) {
  const bodies = query(world, [Body, Position, Velocity])
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) moved = separate(bodies[i], bodies[j]) || moved
    }
    if (!moved) break
  }
}

/**
 * The ball bounces off the legs of any outfielder but the one playing it,
 * and a shot off an opponent's leg stretched out to block it. Runs after the ball has moved and checks the whole path it took this step,
 * so a fast shot can't skip through.
 */
export function ballBodySystem(world: Match, _dt: number) {
  if (world.phase !== 'play' && world.phase !== 'shot') return
  const pass = world.pass
  // A pass doesn't bounce off the passer on its way out, whichever way they're facing.
  const passer = pass && world.time - pass.time < PASSER_CLEARANCE ? pass.from : -1
  for (const eid of query(world, [Outfielder, Body, Position])) {
    if (eid !== world.carrier && eid !== passer && ballOffBody(world, eid)) return
  }
}

/** Pushes two overlapping bodies apart and cancels their closing speed. Returns whether they overlapped. */
function separate(a: number, b: number): boolean {
  const dx = Position.x[b] - Position.x[a]
  const dy = Position.y[b] - Position.y[a]
  const distance = hypot(dx, dy)
  const minimum = Body.radius[a] + Body.radius[b]
  if (distance >= minimum - TOLERANCE || distance === 0) return false
  const nx = dx / distance
  const ny = dy / distance
  const overlap = (minimum - distance) / 2
  Position.x[a] -= nx * overlap
  Position.y[a] -= ny * overlap
  Position.x[b] += nx * overlap
  Position.y[b] += ny * overlap

  const closing = (Velocity.x[b] - Velocity.x[a]) * nx + (Velocity.y[b] - Velocity.y[a]) * ny
  if (closing < 0) {
    Velocity.x[a] += nx * closing * 0.5
    Velocity.y[a] += ny * closing * 0.5
    Velocity.x[b] -= nx * closing * 0.5
    Velocity.y[b] -= ny * closing * 0.5
  }
  return true
}

/** Bounces the ball off `eid` if its path met them this step; returns whether it did. */
function ballOffBody(world: Match, eid: number): boolean {
  const { ball, prevBall } = world
  let reach = 0
  let height = hasComponent(world, eid, Sliding) ? PRONE_HEIGHT : Body.height[eid]
  let contact = firstContact(world, eid, reach)
  if (!contact && world.phase === 'shot' && world.shot && Team.id[eid] !== world.shot.team) {
    reach = BLOCK_STRETCH
    height = BLOCK_HEIGHT
    contact = firstContact(world, eid, reach)
  }
  if (!contact) return false
  const { t, nx, ny } = contact
  const z = prevBall.z + (Position.z[ball] - prevBall.z) * t
  if (z > height) return false
  const into = (Velocity.x[ball] - Velocity.x[eid]) * nx + (Velocity.y[ball] - Velocity.y[eid]) * ny
  if (into >= 0) return false
  // A flagged player who gets in the way of the ball is involved: that's the offence, not a deflection.
  if (offsideOffence(world, eid)) return true
  Velocity.x[ball] -= (1 + BODY_RESTITUTION) * into * nx
  Velocity.y[ball] -= (1 + BODY_RESTITUTION) * into * ny
  const minimum = Body.radius[eid] * LEG_WIDTH + BALL_RADIUS + reach
  Position.x[ball] = Position.x[eid] + nx * minimum
  Position.y[ball] = Position.y[eid] + ny * minimum
  Position.z[ball] = z
  world.lastTouchedBy = eid
  world.lastTouchDeliberate = false
  world.pass = null
  if (world.phase === 'shot') endShot(world, 'blocked', null)
  return true
}

/**
 * Where (as a fraction of this step) the ball's path first came within
 * `reach` (m) of the legs, and the outward normal there; null if it didn't.
 */
function firstContact(world: Match, eid: number, reach: number) {
  const { ball, prevBall } = world
  const r = Body.radius[eid] * LEG_WIDTH + BALL_RADIUS + reach
  const fx = prevBall.x - Position.x[eid]
  const fy = prevBall.y - Position.y[eid]
  const dx = Position.x[ball] - prevBall.x
  const dy = Position.y[ball] - prevBall.y
  const a = dx * dx + dy * dy
  const b = 2 * (fx * dx + fy * dy)
  const c = fx * fx + fy * fy - r * r
  let t: number
  if (c <= 0) t = 0
  else {
    const disc = b * b - 4 * a * c
    if (a === 0 || disc < 0) return null
    t = (-b - Math.sqrt(disc)) / (2 * a)
    if (t < 0 || t > 1) return null
  }
  const px = fx + dx * t
  const py = fy + dy * t
  const len = hypot(px, py)
  if (len === 0) return null
  return { t, nx: px / len, ny: py / len }
}

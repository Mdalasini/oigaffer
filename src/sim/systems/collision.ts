import { query } from 'bitecs'
import { Body, Position, Velocity } from '../components'
import { BALL_RADIUS } from '../constants'
import { endAttack, type Match } from '../match'

/** Share of the ball's speed into a body that it keeps when it bounces off. */
const BODY_RESTITUTION = 0.3
/** Legs and hips present a narrower target than the shoulders. */
const LEG_WIDTH = 0.8

/** Players can't pass through each other, and the ball bounces off the defender. */
export function collisionSystem(world: Match, _dt: number) {
  const bodies = query(world, [Body, Position, Velocity])
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) separate(bodies[i], bodies[j])
  }
  if (world.defenderActive && world.phase !== 'result') ballOffBody(world, world.defender)
}

/** Pushes two overlapping bodies apart and cancels their closing speed. */
function separate(a: number, b: number) {
  const dx = Position.x[b] - Position.x[a]
  const dy = Position.y[b] - Position.y[a]
  const distance = Math.hypot(dx, dy)
  const minimum = Body.radius[a] + Body.radius[b]
  if (distance >= minimum || distance === 0) return
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
}

function ballOffBody(world: Match, eid: number) {
  const ball = world.ball
  if (Position.z[ball] > Body.height[eid]) return
  const dx = Position.x[ball] - Position.x[eid]
  const dy = Position.y[ball] - Position.y[eid]
  const distance = Math.hypot(dx, dy)
  const minimum = Body.radius[eid] * LEG_WIDTH + BALL_RADIUS
  if (distance >= minimum || distance === 0) return
  const nx = dx / distance
  const ny = dy / distance
  const into = (Velocity.x[ball] - Velocity.x[eid]) * nx + (Velocity.y[ball] - Velocity.y[eid]) * ny
  if (into >= 0) return
  Velocity.x[ball] -= (1 + BODY_RESTITUTION) * into * nx
  Velocity.y[ball] -= (1 + BODY_RESTITUTION) * into * ny
  Position.x[ball] = Position.x[eid] + nx * minimum
  Position.y[ball] = Position.y[eid] + ny * minimum
  if (world.phase === 'shot') endAttack(world, 'blocked', null)
}

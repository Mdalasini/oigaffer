import { query } from 'bitecs'
import { Defender, DefenderMode, Facing, MoveIntent, Outfielder, Physical, Position, Velocity } from '../components'
import { GOAL_X } from '../constants'
import { readLag, topSpeed } from '../grades'
import type { Match } from '../match'
import { CONTROL_RADIUS, footDistance } from '../touch'

/** Distance a jockeying defender holds off the ball, goal-side. */
const STANDOFF = 1.7
/** Jockey while this close and goal-side; give chase beyond RUN_DISTANCE or once beaten. */
const JOCKEY_DISTANCE = 6
const RUN_DISTANCE = 8
/** How far ahead (s) each mode projects the carrier's read movement. */
const JOCKEY_LOOKAHEAD = 0.3
const RUN_LOOKAHEAD = 0.6
/** When running, aim this far goal-side of the ball, to get back in front of it. */
const RECOVERY_DEPTH = 3
const POSITION_GAIN = 3

/**
 * The defender's decisions. Jockeying keeps a short read lag and a side-on
 * stance, so it mirrors cuts quickly but can only shuffle at sidestep speed.
 * Running is fast but reads late and turns wide.
 */
export function defenderSystem(world: Match, dt: number) {
  for (const eid of query(world, [Defender, Outfielder, MoveIntent, Position, Velocity, Facing, Physical])) {
    const ball = world.ball
    if (!world.defenderActive || world.phase !== 'approach') {
      stand(eid, ball)
      continue
    }

    updateRead(world, eid, dt)
    if (looseAndNearer(world, eid)) {
      Defender.mode[eid] = DefenderMode.Run
      goForBall(eid)
      continue
    }
    const mode = chooseMode(eid)
    Defender.mode[eid] = mode
    if (mode === DefenderMode.Jockey) jockey(eid)
    else run(eid)
  }
}

/**
 * Advances the defender's read of the ball, then pulls it towards the truth
 * at the defender's reaction rate.
 */
function updateRead(world: Match, eid: number, dt: number) {
  const ball = world.ball
  const lag = readLag(Outfielder.marking[eid], Defender.mode[eid] === DefenderMode.Run)
  const k = 1 - Math.exp(-dt / lag)
  Defender.readX[eid] += Defender.readVx[eid] * dt
  Defender.readY[eid] += Defender.readVy[eid] * dt
  Defender.readX[eid] += (Position.x[ball] - Defender.readX[eid]) * k
  Defender.readY[eid] += (Position.y[ball] - Defender.readY[eid]) * k
  Defender.readVx[eid] += (Velocity.x[ball] - Defender.readVx[eid]) * k
  Defender.readVy[eid] += (Velocity.y[ball] - Defender.readVy[eid]) * k
}

function chooseMode(eid: number): DefenderMode {
  const bx = Defender.readX[eid]
  const by = Defender.readY[eid]
  const distance = Math.hypot(bx - Position.x[eid], by - Position.y[eid])
  const goalSide = distanceToGoal(Position.x[eid], Position.y[eid]) + 0.5 < distanceToGoal(bx, by)
  if (!goalSide || distance > RUN_DISTANCE) return DefenderMode.Run
  if (distance < JOCKEY_DISTANCE) return DefenderMode.Jockey
  return Defender.mode[eid] as DefenderMode
}

/** Hold a spot just goal-side of where the ball is read to be going, facing it. */
function jockey(eid: number) {
  const { x, y } = goalSideOfRead(eid, JOCKEY_LOOKAHEAD, STANDOFF)
  MoveIntent.vx[eid] = Defender.readVx[eid] + (x - Position.x[eid]) * POSITION_GAIN
  MoveIntent.vy[eid] = Defender.readVy[eid] + (y - Position.y[eid]) * POSITION_GAIN
  MoveIntent.faceX[eid] = Defender.readX[eid] - Position.x[eid]
  MoveIntent.faceY[eid] = Defender.readY[eid] - Position.y[eid]
}

/** Sprint to get back goal-side of the ball. */
function run(eid: number) {
  const { x, y } = goalSideOfRead(eid, RUN_LOOKAHEAD, RECOVERY_DEPTH)
  const dx = x - Position.x[eid]
  const dy = y - Position.y[eid]
  const distance = Math.hypot(dx, dy) || 1
  const speed = Math.min(topSpeed(Physical.pace[eid]), distance * POSITION_GAIN)
  MoveIntent.vx[eid] = (dx / distance) * speed
  MoveIntent.vy[eid] = (dy / distance) * speed
  MoveIntent.faceX[eid] = 0
  MoveIntent.faceY[eid] = 0
}

/** The carrier has lost control of the ball and the defender can get there first. */
function looseAndNearer(world: Match, eid: number) {
  const carrierDistance = footDistance(world.striker, world.ball)
  return carrierDistance > CONTROL_RADIUS && footDistance(eid, world.ball) < carrierDistance
}

/** Attack the loose ball at full pace, towards where it's read to be going. */
function goForBall(eid: number) {
  const dx = Defender.readX[eid] + Defender.readVx[eid] * 0.2 - Position.x[eid]
  const dy = Defender.readY[eid] + Defender.readVy[eid] * 0.2 - Position.y[eid]
  const distance = Math.hypot(dx, dy) || 1
  const speed = topSpeed(Physical.pace[eid])
  MoveIntent.vx[eid] = (dx / distance) * speed
  MoveIntent.vy[eid] = (dy / distance) * speed
  MoveIntent.faceX[eid] = 0
  MoveIntent.faceY[eid] = 0
}

function stand(eid: number, ball: number) {
  MoveIntent.vx[eid] = 0
  MoveIntent.vy[eid] = 0
  MoveIntent.faceX[eid] = Position.x[ball] - Position.x[eid]
  MoveIntent.faceY[eid] = Position.y[ball] - Position.y[eid]
}

/** A point `depth` metres towards goal from where the defender reads the ball to be in `lookahead` seconds. */
function goalSideOfRead(eid: number, lookahead: number, depth: number) {
  const bx = Defender.readX[eid] + Defender.readVx[eid] * lookahead
  const by = Defender.readY[eid] + Defender.readVy[eid] * lookahead
  const gx = GOAL_X - bx
  const gy = -by
  const len = Math.hypot(gx, gy) || 1
  return { x: bx + (gx / len) * depth, y: by + (gy / len) * depth }
}

export const distanceToGoal = (x: number, y: number) => Math.hypot(GOAL_X - x, y)

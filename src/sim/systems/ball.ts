import { integrateBall, type BallState } from '../ballmotion'
import { emit } from '../events'
import { collideGoalFrame } from '../goalframe'
import { carryInHands } from '../keeper'
import { BALL_RADIUS } from '../constants'
import { awardGoal, awardRestart } from '../match'
import { GOAL_AREA_DEPTH, GOAL_HEIGHT, GOAL_WIDTH, HALF_LENGTH, HALF_WIDTH } from '../pitch'
import { attackDir, type Sim } from '../sim'
import { Phase, Restart } from '../state'

const b: BallState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }

export function readBall(sim: Sim, out: BallState): BallState {
  const { Pos, Vel, Air } = sim.c
  const e = sim.ball
  out.x = Pos.x[e]
  out.y = Pos.y[e]
  out.z = Air.z[e]
  out.vx = Vel.x[e]
  out.vy = Vel.y[e]
  out.vz = Air.vz[e]
  return out
}

function writeBall(sim: Sim, s: BallState) {
  const { Pos, Vel, Air } = sim.c
  const e = sim.ball
  Pos.x[e] = s.x
  Pos.y[e] = s.y
  Air.z[e] = s.z
  Vel.x[e] = s.vx
  Vel.y[e] = s.vy
  Air.vz[e] = s.vz
}

/** Moves the ball and blows up for goals and balls that leave the pitch. */
export function ballSystem(sim: Sim): void {
  if (sim.m.phase !== Phase.Play) return
  if (sim.m.ball.inHands) return carryInHands(sim)
  readBall(sim, b)
  const fromX = b.x
  const fromY = b.y
  const fromZ = b.z
  integrateBall(b)
  if (collideGoalFrame(fromX, fromY, fromZ, b)) emit(sim, { type: 'woodwork', x: b.x, y: b.y, z: b.z })
  writeBall(sim, b)
  checkOutOfPlay(sim, fromX, fromY, fromZ, b)
}

/** Judges the first line the ball crossed during this tick, where it crossed it. */
function checkOutOfPlay(sim: Sim, fromX: number, fromY: number, fromZ: number, s: BallState) {
  const lineX = HALF_LENGTH + BALL_RADIUS
  const lineY = HALF_WIDTH + BALL_RADIUS
  const outX = Math.abs(s.x) > lineX
  const outY = Math.abs(s.y) > lineY
  if (!outX && !outY) return
  const tx = outX ? (Math.sign(s.x) * lineX - fromX) / (s.x - fromX) : Infinity
  const ty = outY ? (Math.sign(s.y) * lineY - fromY) / (s.y - fromY) : Infinity
  const { m } = sim
  if (tx <= ty) {
    const y = fromY + (s.y - fromY) * tx
    const z = fromZ + (s.z - fromZ) * tx
    const side = s.x > 0 ? 1 : -1
    // The team defending this goal is the one attacking away from it.
    const defending = attackDir(sim, 0) === side ? 1 : 0
    const attacking = 1 - defending
    if (Math.abs(y) < GOAL_WIDTH / 2 - BALL_RADIUS && z < GOAL_HEIGHT - BALL_RADIUS) {
      awardGoal(sim, attacking)
    } else if (m.ball.lastTeam === defending) {
      awardRestart(sim, Restart.Corner, attacking, side * HALF_LENGTH, (y > 0 ? 1 : -1) * HALF_WIDTH)
    } else {
      awardRestart(sim, Restart.GoalKick, defending, side * (HALF_LENGTH - GOAL_AREA_DEPTH), y > 0 ? 5 : -5)
    }
    return
  }
  const x = fromX + (s.x - fromX) * ty
  const team = m.ball.lastTeam === 0 ? 1 : 0
  awardRestart(sim, Restart.ThrowIn, team, Math.max(-HALF_LENGTH, Math.min(HALF_LENGTH, x)), (s.y > 0 ? 1 : -1) * HALF_WIDTH)
}

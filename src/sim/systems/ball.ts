import { integrateBall, type BallState } from '../ballmotion'
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
  readBall(sim, b)
  integrateBall(b)
  writeBall(sim, b)
  checkOutOfPlay(sim, b)
}

function checkOutOfPlay(sim: Sim, s: BallState) {
  const { m } = sim
  if (Math.abs(s.x) > HALF_LENGTH + BALL_RADIUS) {
    const side = s.x > 0 ? 1 : -1
    // The team defending this goal is the one attacking away from it.
    const defending = attackDir(sim, 0) === side ? 1 : 0
    const attacking = 1 - defending
    if (Math.abs(s.y) < GOAL_WIDTH / 2 - BALL_RADIUS && s.z < GOAL_HEIGHT - BALL_RADIUS) {
      awardGoal(sim, attacking)
      return
    }
    if (m.ball.lastTeam === defending) {
      awardRestart(sim, Restart.Corner, attacking, side * HALF_LENGTH, (s.y > 0 ? 1 : -1) * HALF_WIDTH)
    } else {
      awardRestart(sim, Restart.GoalKick, defending, side * (HALF_LENGTH - GOAL_AREA_DEPTH), s.y > 0 ? 5 : -5)
    }
    return
  }
  if (Math.abs(s.y) > HALF_WIDTH + BALL_RADIUS) {
    const team = m.ball.lastTeam === 0 ? 1 : 0
    const x = Math.max(-HALF_LENGTH, Math.min(HALF_LENGTH, s.x))
    awardRestart(sim, Restart.ThrowIn, team, x, (s.y > 0 ? 1 : -1) * HALF_WIDTH)
  }
}

import { addComponent, addEntity, createWorld, type World } from 'bitecs'
import { Ball, Body, Facing, Goalkeeper, MoveIntent, Outfielder, Physical, Position, Velocity } from './components'
import { BALL_RADIUS, FIXED_DT, GOAL_X } from './constants'
import { clampGrade, shotSpreadRadius } from './grades'
import { createRng, type Rng } from './rng'
import type { GoalPoint, Vec3 } from './shooting'
import { ballSystem } from './systems/ball'
import { keeperSystem } from './systems/keeper'
import { outcomeSystem } from './systems/outcome'
import { locomotionSystem } from './systems/locomotion'
import { strikerSystem } from './systems/striker'

export type Phase = 'approach' | 'shot' | 'result'
export type Outcome = 'goal' | 'save' | 'wide' | 'over'

export interface ShotInfo {
  /** Where the ball was struck from. */
  origin: Vec3
  aim: GoalPoint
  radius: number
  target: GoalPoint
  /** Where the ball crossed the goal line or keeper plane, once it has. */
  crossing: GoalPoint | null
}

export interface MatchStats {
  shots: number
  goals: number
  saves: number
  misses: number
}

export interface MatchContext {
  rng: Rng
  phase: Phase
  phaseTime: number
  ball: number
  striker: number
  keeper: number
  /** Distance from goal at which the striker pulls the trigger this attack. */
  shootDistance: number
  /** Whether this attack's shot is aimed high or low. */
  aimHigh: boolean
  shootRequested: boolean
  autoReset: boolean
  shot: ShotInfo | null
  outcome: Outcome | null
  stats: MatchStats
  prevBall: Vec3
  onOutcome?: (outcome: Outcome) => void
}

export type Match = World<MatchContext>

export interface MatchOptions {
  seed?: number
  shooting: number
  reaction: number
}

export function createMatch({ seed = Date.now(), shooting, reaction }: MatchOptions): Match {
  const world = createWorld<MatchContext>({
    rng: createRng(seed),
    phase: 'approach',
    phaseTime: 0,
    ball: 0,
    striker: 0,
    keeper: 0,
    shootDistance: 0,
    aimHigh: false,
    shootRequested: false,
    autoReset: true,
    shot: null,
    outcome: null,
    stats: { shots: 0, goals: 0, saves: 0, misses: 0 },
    prevBall: { x: 0, y: 0, z: 0 },
  })

  world.ball = addEntity(world)
  addComponent(world, world.ball, Position)
  addComponent(world, world.ball, Velocity)
  addComponent(world, world.ball, Ball)

  world.striker = addEntity(world)
  addComponent(world, world.striker, Position)
  addComponent(world, world.striker, Velocity)
  addComponent(world, world.striker, Body)
  addComponent(world, world.striker, Outfielder)
  addComponent(world, world.striker, Facing)
  addComponent(world, world.striker, MoveIntent)
  addComponent(world, world.striker, Physical)
  Physical.pace[world.striker] = 14
  Physical.acceleration[world.striker] = 14
  Physical.agility[world.striker] = 14
  Physical.strength[world.striker] = 12
  Body.radius[world.striker] = 0.35
  Body.height[world.striker] = 1.8

  world.keeper = addEntity(world)
  addComponent(world, world.keeper, Position)
  addComponent(world, world.keeper, Velocity)
  addComponent(world, world.keeper, Body)
  addComponent(world, world.keeper, Goalkeeper)
  addComponent(world, world.keeper, Facing)
  Body.radius[world.keeper] = 0.4
  Body.height[world.keeper] = 1.9

  setGrades(world, shooting, reaction)
  resetPlay(world)
  return world
}

export function setGrades(world: Match, shooting: number, reaction: number) {
  Outfielder.shooting[world.striker] = clampGrade(shooting)
  Goalkeeper.reaction[world.keeper] = clampGrade(reaction)
}

/** Lines the striker up for a fresh run at goal. */
export function resetPlay(world: Match) {
  const { rng, ball, striker, keeper } = world
  setVec(Position, striker, GOAL_X - 32, (rng() * 2 - 1) * 14, 0)
  setVec(Velocity, striker, 0, 0, 0)
  // Start half-turned away so the striker has to come round onto goal.
  Facing.angle[striker] = Math.atan2(-Position.y[striker], GOAL_X - Position.x[striker]) + (rng() * 2 - 1) * 1.6
  setVec(Position, ball, Position.x[striker], Position.y[striker], BALL_RADIUS)
  setVec(Velocity, ball, 0, 0, 0)
  setVec(Position, keeper, GOAL_X - 0.5, 0, 0)
  setVec(Velocity, keeper, 0, 0, 0)
  Goalkeeper.reactTimer[keeper] = 0

  world.phase = 'approach'
  world.phaseTime = 0
  world.shootDistance = 13 + rng() * 6
  world.aimHigh = rng() < 0.5
  world.shootRequested = false
  world.shot = null
  world.outcome = null
}

export function requestShot(world: Match) {
  if (world.phase === 'approach') world.shootRequested = true
}

/** The striker's current spread circle, before or after the shot. */
export function currentSpread(world: Match): number {
  return shotSpreadRadius(Outfielder.shooting[world.striker])
}

export function setPhase(world: Match, phase: Phase) {
  world.phase = phase
  world.phaseTime = 0
}

export function stepMatch(world: Match, dt: number = FIXED_DT) {
  world.phaseTime += dt
  strikerSystem(world, dt)
  locomotionSystem(world, dt)
  keeperSystem(world, dt)
  ballSystem(world, dt)
  outcomeSystem(world, dt)
}

export function setVec(store: typeof Position, eid: number, x: number, y: number, z: number) {
  store.x[eid] = x
  store.y[eid] = y
  store.z[eid] = z
}

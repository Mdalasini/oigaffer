import { addComponent, addEntity, createWorld, type World } from 'bitecs'
import { Ball, Body, Dribbler, Facing, Goalkeeper, MoveIntent, Outfielder, Physical, Position, TouchStyle, Velocity } from './components'
import { BALL_RADIUS, FIXED_DT, GOAL_X } from './constants'
import { clampGrade, shotSpreadRadius } from './grades'
import { createRng, type Rng } from './rng'
import type { GoalPoint, Vec3 } from './shooting'
import { ballSystem } from './systems/ball'
import { keeperSystem } from './systems/keeper'
import { outcomeSystem } from './systems/outcome'
import { locomotionSystem } from './systems/locomotion'
import { strikerSystem } from './systems/striker'
import { touchCooldownSystem, touchSystem } from './systems/touch'

export type Phase = 'approach' | 'shot' | 'result'
export type Outcome =
  | 'goal'
  | 'save'
  | 'wide'
  | 'over'
  /** The keeper gathered a loose ball. */
  | 'claimed'
  /** Open play ran on too long without a shot. */
  | 'abandoned'

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
  /** Attacks that ended without a shot: the ball was lost or play stalled. */
  lost: number
}

export interface LastTouch {
  by: number
  style: TouchStyle
  /** Match time of the touch, and where the ball was. */
  time: number
  x: number
  y: number
}

/** Every 1–20 grade in the match, the role it belongs to and where it is stored. */
export const GRADE_FIELDS = {
  shooting: { role: 'striker', store: Outfielder.shooting },
  dribbling: { role: 'striker', store: Outfielder.dribbling },
  pace: { role: 'striker', store: Physical.pace },
  agility: { role: 'striker', store: Physical.agility },
  reaction: { role: 'keeper', store: Goalkeeper.reaction },
} as const
export type GradeKey = keyof typeof GRADE_FIELDS
export type Grades = Record<GradeKey, number>

export const DEFAULT_GRADES: Grades = { shooting: 14, dribbling: 13, pace: 14, agility: 14, reaction: 12 }

export interface MatchContext {
  rng: Rng
  /** Seconds since the match was created. */
  time: number
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
  lastTouch: LastTouch | null
  onOutcome?: (outcome: Outcome) => void
}

export type Match = World<MatchContext>

export interface MatchOptions {
  seed?: number
  grades?: Partial<Grades>
}

export function createMatch({ seed = Date.now(), grades = {} }: MatchOptions = {}): Match {
  const world = createWorld<MatchContext>({
    rng: createRng(seed),
    time: 0,
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
    stats: { shots: 0, goals: 0, saves: 0, misses: 0, lost: 0 },
    prevBall: { x: 0, y: 0, z: 0 },
    lastTouch: null,
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
  addComponent(world, world.striker, Dribbler)
  Physical.acceleration[world.striker] = 14
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

  for (const key of Object.keys(GRADE_FIELDS) as GradeKey[]) setGrade(world, key, grades[key] ?? DEFAULT_GRADES[key])
  resetPlay(world)
  return world
}

export function setGrade(world: Match, key: GradeKey, grade: number) {
  const { role, store } = GRADE_FIELDS[key]
  store[world[role]] = clampGrade(grade)
}

export function getGrade(world: Match, key: GradeKey): number {
  const { role, store } = GRADE_FIELDS[key]
  return store[world[role]]
}

/** Lines the striker up for a fresh run at goal. */
export function resetPlay(world: Match) {
  const { rng, ball, striker, keeper } = world
  setVec(Position, striker, GOAL_X - 32, (rng() * 2 - 1) * 14, 0)
  setVec(Velocity, striker, 0, 0, 0)
  // Start half-turned away so the striker has to come round onto goal.
  Facing.angle[striker] = Math.atan2(-Position.y[striker], GOAL_X - Position.x[striker]) + (rng() * 2 - 1) * 1.6
  // The ball starts at the striker's feet.
  const facing = Facing.angle[striker]
  setVec(Position, ball, Position.x[striker] + Math.cos(facing) * 0.4, Position.y[striker] + Math.sin(facing) * 0.4, BALL_RADIUS)
  Dribbler.style[striker] = TouchStyle.None
  Dribbler.cooldown[striker] = 0
  setVec(Velocity, ball, 0, 0, 0)
  setVec(Position, keeper, GOAL_X - 0.5, 0, 0)
  setVec(Velocity, keeper, 0, 0, 0)
  Goalkeeper.reactTimer[keeper] = 0

  world.phase = 'approach'
  world.phaseTime = 0
  // Shots come a touch or two after the striker decides to, so plan a little further out.
  world.shootDistance = 16 + rng() * 6
  world.aimHigh = rng() < 0.5
  world.shootRequested = false
  world.shot = null
  world.outcome = null
  world.lastTouch = null
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
  world.time += dt
  world.phaseTime += dt
  touchCooldownSystem(world, dt)
  strikerSystem(world, dt)
  touchSystem(world, dt)
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

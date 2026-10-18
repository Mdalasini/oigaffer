import { addComponent, addEntity, createWorld, hasComponent, removeComponent, type World } from 'bitecs'
import type { LastChallenge } from './challenge'
import {
  Ball,
  Body,
  Defender,
  DefenderMode,
  Dribbler,
  Facing,
  Goalkeeper,
  MoveIntent,
  OffBalance,
  Outfielder,
  Physical,
  Position,
  Shield,
  Sliding,
  TakeOn,
  TouchStyle,
  Velocity,
} from './components'
import { BALL_RADIUS, FIXED_DT, GOAL_X, PITCH_HALF_WIDTH } from './constants'
import { clampGrade, shotSpreadRadius } from './grades'
import { createRng, type Rng } from './rng'
import type { GoalPoint, Vec3 } from './shooting'
import { balanceSystem } from './systems/balance'
import { ballSystem } from './systems/ball'
import { challengeSystem } from './systems/challenge'
import { ballBodySystem, collisionSystem } from './systems/collision'
import { contestSystem } from './systems/contest'
import { defenderSystem } from './systems/defender'
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
  /** A shot that hit the defender. */
  | 'blocked'
  /** The keeper gathered a loose ball. */
  | 'claimed'
  /** The defender won a loose ball. */
  | 'intercepted'
  /** The defender tackled the striker and came away with the ball. */
  | 'tackled'
  /** The striker put the ball out: a goal kick, or a throw-in to the defence. */
  | 'outOfPlay'
  /** The defender put the ball out: a corner, or a throw-in to the attack. */
  | 'setPiece'
  /** Open play ran on too long without a shot. */
  | 'abandoned'

/** How play restarts after the ball goes out. */
export type Restart = 'throw-in' | 'corner' | 'goal-kick'

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
  /** Attacks that ended with the defender putting the ball out: a corner or throw-in to the attack. */
  setPieces: number
}

export interface LastTouch {
  by: number
  style: TouchStyle
  /** Match time of the touch, and where the ball was. */
  time: number
  x: number
  y: number
}

/** Every adjustable 1–20 grade, by role, and the store that holds it. */
export const GRADE_FIELDS = {
  striker: {
    shooting: Outfielder.shooting,
    dribbling: Outfielder.dribbling,
    pace: Physical.pace,
    agility: Physical.agility,
    strength: Physical.strength,
  },
  defender: {
    marking: Outfielder.marking,
    tackling: Outfielder.tackling,
    pace: Physical.pace,
    agility: Physical.agility,
    strength: Physical.strength,
  },
  keeper: { reaction: Goalkeeper.reaction },
} as const
export type Role = keyof typeof GRADE_FIELDS
export type GradeKey<R extends Role> = keyof (typeof GRADE_FIELDS)[R] & string
export type Grades = { [R in Role]: Record<GradeKey<R>, number> }
export type GradeOverrides = { [R in Role]?: Partial<Grades[R]> }

export const DEFAULT_GRADES: Grades = {
  striker: { shooting: 14, dribbling: 13, pace: 14, agility: 14, strength: 12 },
  defender: { marking: 12, tackling: 12, pace: 13, agility: 12, strength: 13 },
  keeper: { reaction: 12 },
}
export const ROLES = Object.keys(GRADE_FIELDS) as Role[]
export const gradeKeys = <R extends Role>(role: R) => Object.keys(GRADE_FIELDS[role]) as GradeKey<R>[]

export interface MatchContext {
  rng: Rng
  /** Seconds since the match was created. */
  time: number
  phase: Phase
  phaseTime: number
  ball: number
  striker: number
  defender: number
  keeper: number
  /** Whether the defender takes part; when not, it stands aside off the pitch. */
  defenderActive: boolean
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
  lastChallenge: LastChallenge | null
  /** Who last played the ball, to decide restarts when it goes out. */
  lastTouchedBy: number
  /** How play restarts, when the attack ended with the ball out of play. */
  restart: Restart | null
  onOutcome?: (outcome: Outcome) => void
}

export type Match = World<MatchContext>

export interface MatchOptions {
  seed?: number
  grades?: GradeOverrides
  defender?: boolean
}

export function createMatch({ seed = Date.now(), grades = {}, defender = true }: MatchOptions = {}): Match {
  const world = createWorld<MatchContext>({
    rng: createRng(seed),
    time: 0,
    phase: 'approach',
    phaseTime: 0,
    ball: 0,
    striker: 0,
    defender: 0,
    keeper: 0,
    defenderActive: defender,
    shootDistance: 0,
    aimHigh: false,
    shootRequested: false,
    autoReset: true,
    shot: null,
    outcome: null,
    stats: { shots: 0, goals: 0, saves: 0, misses: 0, lost: 0, setPieces: 0 },
    prevBall: { x: 0, y: 0, z: 0 },
    lastTouch: null,
    lastChallenge: null,
    lastTouchedBy: -1,
    restart: null,
  })

  world.ball = addEntity(world)
  addComponent(world, world.ball, Position)
  addComponent(world, world.ball, Velocity)
  addComponent(world, world.ball, Ball)

  world.striker = addOutfielder(world)
  addComponent(world, world.striker, Dribbler)
  addComponent(world, world.striker, TakeOn)
  addComponent(world, world.striker, Shield)

  world.defender = addOutfielder(world)
  addComponent(world, world.defender, Defender)

  world.keeper = addEntity(world)
  addComponent(world, world.keeper, Position)
  addComponent(world, world.keeper, Velocity)
  addComponent(world, world.keeper, Body)
  addComponent(world, world.keeper, Goalkeeper)
  addComponent(world, world.keeper, Facing)
  Body.radius[world.keeper] = 0.4
  Body.height[world.keeper] = 1.9

  for (const role of ROLES) {
    for (const key of gradeKeys(role)) {
      const override = (grades[role] as Partial<Record<string, number>> | undefined)?.[key]
      setGrade(world, role, key, override ?? (DEFAULT_GRADES[role] as Record<string, number>)[key])
    }
  }
  resetPlay(world)
  return world
}

function addOutfielder(world: Match): number {
  const eid = addEntity(world)
  for (const component of [Position, Velocity, Body, Outfielder, Facing, MoveIntent, Physical, OffBalance]) {
    addComponent(world, eid, component)
  }
  Physical.acceleration[eid] = 14
  Body.radius[eid] = 0.35
  Body.height[eid] = 1.8
  return eid
}

const gradeStore = (role: Role, key: string): Uint8Array => (GRADE_FIELDS[role] as Record<string, Uint8Array>)[key]

export function setGrade<R extends Role>(world: Match, role: R, key: GradeKey<R>, grade: number) {
  gradeStore(role, key)[world[role]] = clampGrade(grade)
}

export function getGrade<R extends Role>(world: Match, role: R, key: GradeKey<R>): number {
  return gradeStore(role, key)[world[role]]
}

export function setDefenderActive(world: Match, active: boolean) {
  world.defenderActive = active
  resetPlay(world)
}

/** Lines the striker up for a fresh run at goal. */
export function resetPlay(world: Match) {
  const { rng, ball, striker, keeper } = world
  setVec(Position, striker, GOAL_X - 30, (rng() * 2 - 1) * 8, 0)
  setVec(Velocity, striker, 0, 0, 0)
  // Start half-turned away so the striker has to come round onto goal.
  Facing.angle[striker] = Math.atan2(-Position.y[striker], GOAL_X - Position.x[striker]) + (rng() * 2 - 1) * 1.6
  // The ball starts at the striker's feet.
  const facing = Facing.angle[striker]
  setVec(Position, ball, Position.x[striker] + Math.cos(facing) * 0.4, Position.y[striker] + Math.sin(facing) * 0.4, BALL_RADIUS)
  Dribbler.style[striker] = TouchStyle.None
  Dribbler.cooldown[striker] = 0
  setVec(Velocity, ball, 0, 0, 0)
  TakeOn.side[striker] = 0
  TakeOn.feintTimer[striker] = 0
  TakeOn.checkBackTimer[striker] = 0
  Shield.active[striker] = 0
  Shield.timer[striker] = 0
  OffBalance.timer[striker] = 0
  placeDefender(world)
  setVec(Position, keeper, GOAL_X - 0.5, 0, 0)
  setVec(Velocity, keeper, 0, 0, 0)
  Goalkeeper.reactTimer[keeper] = 0

  world.phase = 'approach'
  world.phaseTime = 0
  // Shots come a touch or two after the striker decides to, so plan a little further out.
  world.shootDistance = 13 + rng() * 5
  world.aimHigh = rng() < 0.5
  world.shootRequested = false
  world.shot = null
  world.outcome = null
  world.lastTouch = null
  world.lastChallenge = null
  world.lastTouchedBy = striker
  world.restart = null
}

/** The defender starts goal-side of the striker, ready to step up. */
function placeDefender(world: Match) {
  const { rng, defender, striker } = world
  if (world.defenderActive) {
    setVec(Position, defender, GOAL_X - 17 + rng() * 3, Position.y[striker] * 0.5 + (rng() * 2 - 1) * 2, 0)
  } else {
    setVec(Position, defender, GOAL_X - 17, PITCH_HALF_WIDTH + 10, 0)
  }
  setVec(Velocity, defender, 0, 0, 0)
  Facing.angle[defender] = Math.atan2(Position.y[striker] - Position.y[defender], Position.x[striker] - Position.x[defender])
  Defender.mode[defender] = DefenderMode.Jockey
  Defender.actionTime[defender] = 0
  Defender.contacted[defender] = 0
  OffBalance.timer[defender] = 0
  if (hasComponent(world, defender, Sliding)) removeComponent(world, defender, Sliding)
  Defender.readX[defender] = Position.x[world.ball]
  Defender.readY[defender] = Position.y[world.ball]
  Defender.readVx[defender] = 0
  Defender.readVy[defender] = 0
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

const OUTCOME_STAT: Record<Outcome, keyof MatchStats> = {
  goal: 'goals',
  save: 'saves',
  wide: 'misses',
  over: 'misses',
  blocked: 'misses',
  claimed: 'lost',
  intercepted: 'lost',
  tackled: 'lost',
  outOfPlay: 'lost',
  setPiece: 'setPieces',
  abandoned: 'lost',
}

/** Ends the attack: records the outcome, then pauses on the result. */
export function endAttack(world: Match, outcome: Outcome, crossing: GoalPoint | null) {
  world.outcome = outcome
  if (world.shot) world.shot.crossing = crossing
  world.stats[OUTCOME_STAT[outcome]]++
  setPhase(world, 'result')
  world.onOutcome?.(outcome)
}

export function stepMatch(world: Match, dt: number = FIXED_DT) {
  world.time += dt
  world.phaseTime += dt
  touchCooldownSystem(world, dt)
  balanceSystem(world, dt)
  strikerSystem(world, dt)
  defenderSystem(world, dt)
  touchSystem(world, dt)
  locomotionSystem(world, dt)
  challengeSystem(world, dt)
  keeperSystem(world, dt)
  collisionSystem(world, dt)
  ballSystem(world, dt)
  ballBodySystem(world, dt)
  contestSystem(world, dt)
  outcomeSystem(world, dt)
}

export function setVec(store: typeof Position, eid: number, x: number, y: number, z: number) {
  store.x[eid] = x
  store.y[eid] = y
  store.z[eid] = z
}

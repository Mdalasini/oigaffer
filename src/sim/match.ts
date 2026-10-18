import { addComponent, addEntity, createWorld, hasComponent, removeComponent, type World } from 'bitecs'
import type { LastChallenge } from './challenge'
import {
  Attacking,
  Ball,
  Body,
  Defender,
  DefenderMode,
  Defending,
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
  Team,
  TouchStyle,
  Velocity,
} from './components'
import { BALL_RADIUS, CIRCLE_RADIUS, FIXED_DT, GOAL_AREA_DEPTH, PITCH_HALF_LENGTH, PITCH_HALF_WIDTH } from './constants'
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
import { locomotionSystem } from './systems/locomotion'
import { outcomeSystem } from './systems/outcome'
import { strikerSystem } from './systems/striker'
import { touchCooldownSystem, touchSystem } from './systems/touch'
import { attackDir, attackedGoalX, opponent, ownGoalX, TEAM_NAMES, type TeamName } from './teams'

/** Open play, a shot on its way, or the ball dead before a restart. */
export type Phase = 'play' | 'shot' | 'stopped'
/** How a shot ended. A blocked shot stays in play. */
export type ShotOutcome = 'goal' | 'save' | 'wide' | 'over' | 'blocked'
/**
 * Moments worth telling the viewer about. `claimed`: a keeper gathered a loose
 * ball. `tackled` / `intercepted`: the defending team won the ball back.
 * `out`: the ball left the pitch.
 */
export type MatchEventKind = ShotOutcome | 'claimed' | 'tackled' | 'intercepted' | 'out'

export interface MatchEvent {
  kind: MatchEventKind
  /** The team it's about: the shooter, the team that won the ball, or the team given the restart. */
  team: number
  time: number
}

export type RestartKind = 'kick-off' | 'throw-in' | 'corner' | 'goal-kick'

/** How and where play starts again once the ball is dead, and which team takes it. */
export interface Restart {
  kind: RestartKind
  team: number
  x: number
  y: number
}

export interface ShotInfo {
  team: number
  /** The goal line the shot is aimed at. */
  goalX: number
  /** Where the ball was struck from. */
  origin: Vec3
  aim: GoalPoint
  radius: number
  target: GoalPoint
  /** Where the ball crossed the goal line or keeper plane, once it has. */
  crossing: GoalPoint | null
}

export interface TeamStats {
  goals: number
  shots: number
  /** Shots kept out by the other keeper. */
  saved: number
  /** Shots wide, over or blocked. */
  missed: number
  /** Times the team won the ball back in open play. */
  won: number
  /** Spells on the ball: from winning it or a restart until losing it or a stoppage. */
  attacks: number
}

export interface LastTouch {
  by: number
  style: TouchStyle
  /** Match time of the touch, and where the ball was. */
  time: number
  x: number
  y: number
}

export interface TeamPlayers {
  outfielder: number
  keeper: number
}

/** Every adjustable 1–20 grade, by role, and the store that holds it. */
export const GRADE_FIELDS = {
  outfielder: {
    shooting: Outfielder.shooting,
    dribbling: Outfielder.dribbling,
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
export type RoleGrades = { [R in Role]: Record<GradeKey<R>, number> }
export type Grades = Record<TeamName, RoleGrades>
export type GradeOverrides = { [T in TeamName]?: { [R in Role]?: Partial<RoleGrades[R]> } }

export const DEFAULT_GRADES: RoleGrades = {
  outfielder: { shooting: 14, dribbling: 13, marking: 12, tackling: 12, pace: 14, agility: 13, strength: 12 },
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
  teams: [TeamPlayers, TeamPlayers]
  /** The team on the ball. */
  possession: number
  /** The roles of the moment: the outfielder on the ball, the one trying to win it, and the keeper they're attacking. */
  striker: number
  defender: number
  keeper: number
  /** Distance from goal at which the striker pulls the trigger this attack. */
  shootDistance: number
  /** Whether this attack's shot is aimed high or low. */
  aimHigh: boolean
  shootRequested: boolean
  shot: ShotInfo | null
  /** The latest notable moment. */
  event: MatchEvent | null
  /** How play will restart, while the ball is dead. */
  restart: Restart | null
  stats: [TeamStats, TeamStats]
  prevBall: Vec3
  lastTouch: LastTouch | null
  lastChallenge: LastChallenge | null
  /** Who last played the ball, to decide restarts when it goes out. */
  lastTouchedBy: number
  onEvent?: (event: MatchEvent) => void
}

export type Match = World<MatchContext>

export interface MatchOptions {
  seed?: number
  grades?: GradeOverrides
}

/** Seconds a player who has just lost the ball waits before challenging for it. */
const CHALLENGE_DELAY_ON_LOSS = 0.6

const emptyStats = (): TeamStats => ({ goals: 0, shots: 0, saved: 0, missed: 0, won: 0, attacks: 0 })

export function createMatch({ seed = Date.now(), grades = {} }: MatchOptions = {}): Match {
  const world = createWorld<MatchContext>({
    rng: createRng(seed),
    time: 0,
    phase: 'play',
    phaseTime: 0,
    ball: 0,
    teams: [
      { outfielder: 0, keeper: 0 },
      { outfielder: 0, keeper: 0 },
    ],
    possession: 0,
    striker: 0,
    defender: 0,
    keeper: 0,
    shootDistance: 0,
    aimHigh: false,
    shootRequested: false,
    shot: null,
    event: null,
    restart: null,
    stats: [emptyStats(), emptyStats()],
    prevBall: { x: 0, y: 0, z: 0 },
    lastTouch: null,
    lastChallenge: null,
    lastTouchedBy: -1,
  })

  world.ball = addEntity(world)
  addComponent(world, world.ball, Position)
  addComponent(world, world.ball, Velocity)
  addComponent(world, world.ball, Ball)

  for (const team of [0, 1]) world.teams[team].outfielder = addOutfielder(world, team)
  for (const team of [0, 1]) world.teams[team].keeper = addKeeper(world, team)

  TEAM_NAMES.forEach((name, team) => {
    for (const role of ROLES) {
      for (const key of gradeKeys(role)) {
        const override = (grades[name]?.[role] as Partial<Record<string, number>> | undefined)?.[key]
        gradeStore(role, key)[playerFor(world, team, role)] = clampGrade(override ?? (DEFAULT_GRADES[role] as Record<string, number>)[key])
      }
    }
  })
  kickOff(world, 0)
  return world
}

/**
 * An outfielder can carry the ball and defend: which it does is down to the
 * Attacking or Defending tag, swapped whenever the ball changes hands.
 */
function addOutfielder(world: Match, team: number): number {
  const eid = addEntity(world)
  for (const component of [Position, Velocity, Body, Outfielder, Facing, MoveIntent, Physical, OffBalance, Team, Dribbler, TakeOn, Shield, Defender]) {
    addComponent(world, eid, component)
  }
  Team.id[eid] = team
  Physical.acceleration[eid] = 14
  Body.radius[eid] = 0.35
  Body.height[eid] = 1.8
  return eid
}

function addKeeper(world: Match, team: number): number {
  const eid = addEntity(world)
  for (const component of [Position, Velocity, Body, Goalkeeper, Facing, Team]) addComponent(world, eid, component)
  Team.id[eid] = team
  Body.radius[eid] = 0.4
  Body.height[eid] = 1.9
  return eid
}

const gradeStore = (role: Role, key: string): Uint8Array => (GRADE_FIELDS[role] as Record<string, Uint8Array>)[key]
const playerFor = (world: Match, team: number, role: Role) => (role === 'keeper' ? world.teams[team].keeper : world.teams[team].outfielder)
const teamIndex = (name: TeamName) => TEAM_NAMES.indexOf(name)

export function setGrade<R extends Role>(world: Match, team: TeamName, role: R, key: GradeKey<R>, grade: number) {
  gradeStore(role, key)[playerFor(world, teamIndex(team), role)] = clampGrade(grade)
}

export function getGrade<R extends Role>(world: Match, team: TeamName, role: R, key: GradeKey<R>): number {
  return gradeStore(role, key)[playerFor(world, teamIndex(team), role)]
}

/** Starts the match again: score cleared, red to kick off. */
export function resetMatch(world: Match) {
  world.stats = [emptyStats(), emptyStats()]
  world.event = null
  kickOff(world, 0)
}

export function kickOff(world: Match, team: number) {
  world.restart = { kind: 'kick-off', team, x: 0, y: 0 }
  takeRestart(world)
}

/**
 * Hands the ball to `team`: its outfielder attacks and the other one defends.
 * Called whenever the ball changes hands, in open play or at a restart.
 */
export function setPossession(world: Match, team: number) {
  const attacker = world.teams[team].outfielder
  const defender = world.teams[opponent(team)].outfielder
  world.possession = team
  world.striker = attacker
  world.defender = defender
  world.keeper = world.teams[opponent(team)].keeper
  world.stats[team].attacks++

  if (hasComponent(world, attacker, Defending)) removeComponent(world, attacker, Defending)
  addComponent(world, attacker, Attacking)
  if (hasComponent(world, defender, Attacking)) removeComponent(world, defender, Attacking)
  addComponent(world, defender, Defending)

  for (const eid of [attacker, defender]) Dribbler.style[eid] = TouchStyle.None
  TakeOn.side[attacker] = 0
  TakeOn.feintTimer[attacker] = 0
  TakeOn.checkBackTimer[attacker] = 0
  Shield.active[attacker] = 0
  Shield.timer[attacker] = 0

  // The player who lost it knows where the ball is, but needs a moment to turn before challenging.
  const mode = Defender.mode[defender]
  if (mode !== DefenderMode.SlideTackle && mode !== DefenderMode.Grounded) Defender.mode[defender] = DefenderMode.Run
  Defender.readX[defender] = Position.x[world.ball]
  Defender.readY[defender] = Position.y[world.ball]
  Defender.readVx[defender] = Velocity.x[world.ball]
  Defender.readVy[defender] = Velocity.y[world.ball]
  Defender.challengeDelay[defender] = CHALLENGE_DELAY_ON_LOSS

  // Shots come a touch or two after the striker decides to, so plan a little further out.
  world.shootDistance = 13 + world.rng() * 5
  world.aimHigh = world.rng() < 0.5
  world.shootRequested = false
}

/** The defending team wins the ball in open play and goes the other way. */
export function winBall(world: Match, team: number, kind: 'tackled' | 'intercepted') {
  world.stats[team].won++
  // The winner played it last, so a ball that runs out straight away goes against them.
  world.lastTouchedBy = world.teams[team].outfielder
  setPossession(world, team)
  record(world, kind, team)
}

/** Settles a shot: tallies it for the shooting team, then stops play or plays on. */
export function endShot(world: Match, outcome: ShotOutcome, crossing: GoalPoint | null) {
  const shot = world.shot
  if (!shot) return
  shot.crossing = crossing
  const stats = world.stats[shot.team]
  if (outcome === 'goal') stats.goals++
  else if (outcome === 'save') stats.saved++
  else stats.missed++

  const defending = opponent(shot.team)
  if (outcome === 'goal') stopPlay(world, 'kick-off', defending, 0, 0)
  else if (outcome === 'blocked') {
    // Play goes on, so the shot is history: guides and the goal view follow the live attack again.
    world.shot = null
    setPhase(world, 'play')
  }
  else stopPlay(world, 'goal-kick', defending, 0, 0)
  record(world, outcome, shot.team)
}

/** A goal that went in without a shot being struck: counted as one, so goals stay a share of shots. */
export function scoreFromPlay(world: Match, team: number) {
  world.stats[team].shots++
  world.stats[team].goals++
  stopPlay(world, 'kick-off', opponent(team), 0, 0)
  record(world, 'goal', team)
}

/** A keeper gathers a loose ball; their team restarts with it. */
export function keeperClaims(world: Match, keeper: number) {
  const team = Team.id[keeper]
  if (team !== world.possession) world.stats[team].won++
  stopPlay(world, 'goal-kick', team, 0, 0)
  record(world, 'claimed', team)
}

/** The ball has gone out: play stops, and `team` restarts from about (x, y). */
export function ballOut(world: Match, kind: Exclude<RestartKind, 'kick-off'>, team: number, x: number, y: number) {
  stopPlay(world, kind, team, x, y)
  record(world, 'out', team)
}

function stopPlay(world: Match, kind: RestartKind, team: number, x: number, y: number) {
  world.restart = { kind, team, x, y }
  setPhase(world, 'stopped')
}

function record(world: Match, kind: MatchEventKind, team: number) {
  world.event = { kind, team, time: world.time }
  world.onEvent?.(world.event)
}

/**
 * Sets the ball and players for the pending restart, gives the ball to the
 * team taking it, and resumes play. The taker starts with the ball at their
 * feet; the opponent stands off goal-side.
 */
export function takeRestart(world: Match) {
  const restart = world.restart
  if (!restart) return
  const { rng, ball } = world
  const { kind, team } = restart
  const dir = attackDir(team)
  const goalX = attackedGoalX(team)
  const L = PITCH_HALF_LENGTH
  const W = PITCH_HALF_WIDTH
  const side = (y: number) => (y >= 0 ? 1 : -1)

  // Where the ball goes, which way the taker faces, and how far off the opponent stands.
  let bx = 0
  let by = 0
  let faceX = dir
  let faceY = 0
  let standOff = CIRCLE_RADIUS + 1
  if (kind === 'throw-in') {
    bx = clamp(restart.x, -L + 1, L - 1)
    by = side(restart.y) * (W - 0.3)
    faceX = dir
    faceY = -side(by)
    standOff = 4
  } else if (kind === 'corner') {
    bx = goalX - dir * 0.5
    by = side(restart.y) * (W - 0.5)
    faceX = goalX - bx
    faceY = -by
    standOff = 5
  } else if (kind === 'goal-kick') {
    bx = ownGoalX(team) + dir * GOAL_AREA_DEPTH
    by = (rng() < 0.5 ? -1 : 1) * 3
    standOff = 12
  }
  const faceLen = Math.hypot(faceX, faceY)
  faceX /= faceLen
  faceY /= faceLen

  for (const eid of [world.teams[0].outfielder, world.teams[1].outfielder]) {
    setVec(Velocity, eid, 0, 0, 0)
    OffBalance.timer[eid] = 0
    Defender.mode[eid] = DefenderMode.Jockey
    Defender.actionTime[eid] = 0
    Defender.contacted[eid] = 0
    if (hasComponent(world, eid, Sliding)) removeComponent(world, eid, Sliding)
  }
  for (const t of [0, 1]) {
    const keeper = world.teams[t].keeper
    setVec(Position, keeper, ownGoalX(t) + attackDir(t) * 0.5, 0, 0)
    setVec(Velocity, keeper, 0, 0, 0)
    Goalkeeper.reactTimer[keeper] = 0
  }

  setVec(Position, ball, bx, by, BALL_RADIUS)
  setVec(Velocity, ball, 0, 0, 0)
  const taker = world.teams[team].outfielder
  setVec(Position, taker, bx - faceX * 0.5, by - faceY * 0.5, 0)
  Facing.angle[taker] = Math.atan2(faceY, faceX)
  Dribbler.cooldown[taker] = 0

  // The opponent stands off towards the goal the taker attacks, a little to one side.
  const other = world.teams[opponent(team)].outfielder
  const gx = goalX - bx
  const gy = -by
  const gLen = Math.hypot(gx, gy) || 1
  const lateral = (rng() * 2 - 1) * 1.5
  const ox = kind === 'kick-off' ? dir * standOff : bx + (gx / gLen) * standOff - (gy / gLen) * lateral
  const oy = kind === 'kick-off' ? lateral : by + (gy / gLen) * standOff + (gx / gLen) * lateral
  setVec(Position, other, clamp(ox, -L + 1, L - 1), clamp(oy, -W + 1, W - 1), 0)
  Facing.angle[other] = Math.atan2(by - Position.y[other], bx - Position.x[other])

  world.shot = null
  world.lastTouch = null
  world.lastChallenge = null
  world.lastTouchedBy = taker
  world.restart = null
  setPossession(world, team)
  Defender.mode[other] = DefenderMode.Jockey
  Defender.challengeDelay[other] = 0
  setPhase(world, 'play')
}

export function requestShot(world: Match) {
  if (world.phase === 'play') world.shootRequested = true
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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))


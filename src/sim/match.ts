import { addComponent, addEntity, createWorld, hasComponent, query, removeComponent, type World } from 'bitecs'
import type { LastChallenge } from './challenge'
import type { PassOption } from './playmaking'
import {
  Ball,
  Body,
  Call,
  Defender,
  DefenderMode,
  Dribbler,
  Facing,
  Goalkeeper,
  Mark,
  MoveIntent,
  OffBalance,
  OffBall,
  Offside,
  OnBall,
  Outfielder,
  Passer,
  Physical,
  Position,
  Pressing,
  Run,
  Shield,
  Sliding,
  Slot,
  TakeOn,
  Team,
  TouchStyle,
  Velocity,
} from './components'
import { BALL_RADIUS, CIRCLE_RADIUS, FIXED_DT, GOAL_AREA_DEPTH, OUTFIELDERS_PER_SIDE, PITCH_HALF_LENGTH, PITCH_HALF_WIDTH } from './constants'
import { clampGrade } from './grades'
import { planShot } from './finishing'
import { createRng, type Rng } from './rng'
import { clearIntentions } from './attacking'
import { clearOffside, playedBy } from './offside'
import { baseLine, homePosition } from './shape'
import { arrivalTime } from './space/arrival'
import type { GoalPoint, Vec3 } from './shooting'
import { balanceSystem } from './systems/balance'
import { ballSystem } from './systems/ball'
import { challengeSystem } from './systems/challenge'
import { ballBodySystem, collisionSystem } from './systems/collision'
import { contestSystem } from './systems/contest'
import { defenderSystem } from './systems/defender'
import { defendingSystem } from './systems/defending'
import { keeperSystem } from './systems/keeper'
import { locomotionSystem } from './systems/locomotion'
import { offBallSystem } from './systems/offBall'
import { outcomeSystem } from './systems/outcome'
import { receiveSystem } from './systems/receive'
import { rolesSystem } from './systems/roles'
import { carrierSystem } from './systems/carrier'
import { touchCooldownSystem, touchSystem } from './systems/touch'
import { attackDir, attackedGoalX, opponent, ownGoalX, TEAM_NAMES, type TeamName } from './teams'

/** Open play, a shot on its way, a keeper with the ball in their hands, or the ball dead before a restart. */
export type Phase = 'play' | 'shot' | 'held' | 'stopped'
/** How a shot ended. A parried or blocked shot stays in play. */
export type ShotOutcome = 'goal' | 'caught' | 'parried' | 'wide' | 'over' | 'blocked'
/**
 * Moments worth telling the viewer about. `claimed`: a keeper gathered a loose
 * ball. `tackled` / `intercepted`: the defending team won the ball back.
 * `out`: the ball left the pitch.
 */
export type MatchEventKind = ShotOutcome | 'claimed' | 'tackled' | 'intercepted' | 'out' | 'offside'

export interface MatchEvent {
  kind: MatchEventKind
  /** The team it's about: the shooter, the team that won the ball, or the team given the restart. */
  team: number
  time: number
}

/** A free kick here is always indirect: the only kind awarded is for offside. */
export type RestartKind = 'kick-off' | 'throw-in' | 'corner' | 'goal-kick' | 'free-kick'

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

/** A pass to feet, or one played into space for the receiver to run onto. */
export type PassKind = 'feet' | 'through'

/** A pass on its way: who played it, who it's for, and where they're meant to meet it. */
export interface PassInfo {
  from: number
  to: number
  kind: PassKind
  x: number
  y: number
  time: number
}

export interface TeamStats {
  goals: number
  shots: number
  /** Passes played, and how many reached the player they were meant for. */
  passes: number
  completed: number
  /** Shots kept out by the other keeper, caught or parried. */
  saved: number
  /** Shots wide, over or blocked. */
  missed: number
  /** Times the team won the ball back in open play. */
  won: number
  /** Times a player of theirs was caught offside. */
  offsides: number
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
  outfielders: number[]
  keeper: number
}

/** Every adjustable 1–20 grade, by role, and the store that holds it. */
export const GRADE_FIELDS = {
  outfielder: {
    shooting: Outfielder.shooting,
    dribbling: Outfielder.dribbling,
    marking: Outfielder.marking,
    tackling: Outfielder.tackling,
    passing: Outfielder.passing,
    firstTouch: Outfielder.firstTouch,
    vision: Outfielder.vision,
    decisions: Outfielder.decisions,
    offTheBall: Outfielder.offTheBall,
    positioning: Outfielder.positioning,
    pace: Physical.pace,
    agility: Physical.agility,
    strength: Physical.strength,
  },
  keeper: { reaction: Goalkeeper.reaction, handling: Goalkeeper.handling },
} as const
export type Role = keyof typeof GRADE_FIELDS
export type GradeKey<R extends Role> = keyof (typeof GRADE_FIELDS)[R] & string
export type RoleGrades = { [R in Role]: Record<GradeKey<R>, number> }
export type Grades = Record<TeamName, RoleGrades>
export type GradeOverrides = { [T in TeamName]?: { [R in Role]?: Partial<RoleGrades[R]> } }

export const DEFAULT_GRADES: RoleGrades = {
  outfielder: {
    shooting: 14,
    dribbling: 13,
    marking: 12,
    tackling: 12,
    passing: 13,
    firstTouch: 13,
    vision: 12,
    decisions: 12,
    offTheBall: 12,
    positioning: 12,
    pace: 14,
    agility: 13,
    strength: 12,
  },
  keeper: { reaction: 12, handling: 12 },
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
  /**
   * The roles of the moment: the outfielder on the ball, the opponent
   * engaging them to win it, and the keeper whose goal they're attacking.
   */
  carrier: number
  presser: number
  keeper: number
  /** Distance from goal at which the carrier pulls the trigger this attack. */
  shootDistance: number
  /** Whether this attack's shot is aimed high or low. */
  aimHigh: boolean
  shootRequested: boolean
  shot: ShotInfo | null
  /** The pass on its way, until it's received or broken up. Its receiver is the carrier meanwhile. */
  pass: PassInfo | null
  /** A pass the carrier has chosen and is shaping to strike, at match time `at`. */
  windup: { carrier: number; option: PassOption; at: number } | null
  /** Each team's defensive line, in that team's `along` terms: it moves as a unit, stepping up and dropping off. */
  lines: [number, number]
  /** Match time at which each team next shares out its marking jobs. */
  nextMarking: [number, number]
  /** Match time until which each team is springing the offside trap: its line stepping up together on a pass. */
  trap: [number, number]
  /** The restart just taken can't produce an offside, so the next touch takes no offside snapshot. */
  offsideExempt: boolean
  /**
   * The taker of an indirect free kick, until someone else touches the ball;
   * -1 otherwise. A goal can't be scored straight from one.
   */
  indirectTaker: number
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
  /**
   * Whether that was a deliberate kick (a touch, shot or pass) rather than a
   * deflection or a tackle. A keeper can't pick up a ball their own outfielder
   * deliberately played to them.
   */
  lastTouchDeliberate: boolean
  onEvent?: (event: MatchEvent) => void
}

export type Match = World<MatchContext>

export interface MatchOptions {
  seed?: number
  grades?: GradeOverrides
  /** Outfielders a side, besides the keeper. */
  outfielders?: number
}

/** Seconds a player who has just lost the ball waits before challenging for it. */
const CHALLENGE_DELAY_ON_LOSS = 0.6
/** Players take this long, plus up to as long again, to react to the ball changing hands. */
const TURNOVER_REACTION = 0.2
/** How far (m) opponents stand from a free kick: 9.15 m scaled to this pitch. */
const FREE_KICK_DISTANCE = 5
/** Reach (m) that counts as getting to the ball. */
const CONTROL_REACH = 0.9

const emptyStats = (): TeamStats => ({ goals: 0, shots: 0, passes: 0, completed: 0, saved: 0, missed: 0, won: 0, offsides: 0, attacks: 0 })

export function createMatch({ seed = Date.now(), grades = {}, outfielders = OUTFIELDERS_PER_SIDE }: MatchOptions = {}): Match {
  const world = createWorld<MatchContext>({
    rng: createRng(seed),
    time: 0,
    phase: 'play',
    phaseTime: 0,
    ball: 0,
    teams: [
      { outfielders: [], keeper: 0 },
      { outfielders: [], keeper: 0 },
    ],
    possession: 0,
    carrier: 0,
    presser: 0,
    keeper: 0,
    shootDistance: 0,
    aimHigh: false,
    shootRequested: false,
    shot: null,
    pass: null,
    windup: null,
    offsideExempt: false,
    lines: [0, 0],
    nextMarking: [0, 0],
    trap: [0, 0],
    indirectTaker: -1,
    event: null,
    restart: null,
    stats: [emptyStats(), emptyStats()],
    prevBall: { x: 0, y: 0, z: 0 },
    lastTouch: null,
    lastChallenge: null,
    lastTouchedBy: -1,
    lastTouchDeliberate: false,
  })

  world.ball = addEntity(world)
  addFresh(world, world.ball, Position)
  addFresh(world, world.ball, Velocity)
  addFresh(world, world.ball, Ball)

  for (const team of [0, 1]) {
    world.teams[team].outfielders = Array.from({ length: outfielders }, (_, slot) => addOutfielder(world, team, slot))
  }
  for (const team of [0, 1]) world.teams[team].keeper = addKeeper(world, team)

  TEAM_NAMES.forEach((name, team) => {
    for (const role of ROLES) {
      for (const key of gradeKeys(role)) {
        const override = (grades[name]?.[role] as Partial<Record<string, number>> | undefined)?.[key]
        const grade = clampGrade(override ?? (DEFAULT_GRADES[role] as Record<string, number>)[key])
        for (const eid of playersFor(world, team, role)) gradeStore(role, key)[eid] = grade
      }
    }
  })
  kickOff(world, 0)
  return world
}

/**
 * An outfielder can carry the ball or press it: the OnBall and Pressing tags
 * mark who is doing which right now.
 */
function addOutfielder(world: Match, team: number, slot: number): number {
  const eid = addEntity(world)
  for (const component of [Position, Velocity, Body, Outfielder, Facing, MoveIntent, Physical, OffBalance, Team, Dribbler, TakeOn, Shield, Defender, Slot, OffBall, Passer, Offside, Run, Call, Mark]) {
    addFresh(world, eid, component)
  }
  Team.id[eid] = team
  Slot.index[eid] = slot
  Mark.target[eid] = -1
  Physical.acceleration[eid] = 14
  Body.radius[eid] = 0.35
  Body.height[eid] = 1.8
  return eid
}

function addKeeper(world: Match, team: number): number {
  const eid = addEntity(world)
  for (const component of [Position, Velocity, Body, Goalkeeper, Facing, Team]) addFresh(world, eid, component)
  Team.id[eid] = team
  Body.radius[eid] = 0.4
  Body.height[eid] = 1.9
  return eid
}

/**
 * Adds `component` to `eid` with every field zeroed. Stores are shared by
 * all worlds, so without this an entity would inherit whatever the same id
 * held in an earlier match.
 */
function addFresh(world: Match, eid: number, component: Record<string, unknown>) {
  addComponent(world, eid, component)
  for (const field of Object.values(component)) if (ArrayBuffer.isView(field)) (field as Float32Array)[eid] = 0
}

const gradeStore = (role: Role, key: string): Uint8Array => (GRADE_FIELDS[role] as Record<string, Uint8Array>)[key]
/** Grades are set per role for the whole team: every outfielder on a side shares them. */
const playersFor = (world: Match, team: number, role: Role) => (role === 'keeper' ? [world.teams[team].keeper] : world.teams[team].outfielders)
const teamIndex = (name: TeamName) => TEAM_NAMES.indexOf(name)

export function setGrade<R extends Role>(world: Match, team: TeamName, role: R, key: GradeKey<R>, grade: number) {
  for (const eid of playersFor(world, teamIndex(team), role)) gradeStore(role, key)[eid] = clampGrade(grade)
}

export function getGrade<R extends Role>(world: Match, team: TeamName, role: R, key: GradeKey<R>): number {
  return gradeStore(role, key)[playersFor(world, teamIndex(team), role)[0]]
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
 * Hands the ball to `team`, with `carrier` on it, and sends the opponent
 * best placed to engage them. Called whenever the ball changes hands, in open
 * play or at a restart.
 */
export function setPossession(world: Match, team: number, carrier: number) {
  const lost = world.carrier
  world.pass = null
  world.nextMarking = [0, 0]
  // The other team has played it on purpose, which ends any offside.
  clearOffside(world)
  world.possession = team
  world.keeper = world.teams[opponent(team)].keeper
  world.stats[team].attacks++
  handOver(world, carrier)
  // Everyone takes a moment to register the change before they reshape.
  for (const t of [0, 1]) {
    for (const eid of world.teams[t].outfielders) OffBall.decideIn[eid] = TURNOVER_REACTION + world.rng() * TURNOVER_REACTION
  }
  const presser = quickestTo(world, opponent(team), Position.x[world.ball], Position.y[world.ball])
  // The player who lost it needs a moment to turn before challenging.
  engage(world, presser, presser === lost ? CHALLENGE_DELAY_ON_LOSS : 0)

  // Shots come a touch or two after the carrier decides to, so plan a little further out.
  world.shootDistance = 13 + world.rng() * 5
  world.aimHigh = world.rng() < 0.5
  world.shootRequested = false
}

/** `eid` takes the ball on for their team: from a teammate, a loose ball, or the keeper. */
export function handOver(world: Match, eid: number) {
  // Anyone but the receiver taking over means the pass didn't arrive.
  if (world.pass && world.pass.to !== eid) world.pass = null
  Dribbler.style[world.carrier] = TouchStyle.None
  setCarrier(world, eid)
  Dribbler.style[eid] = TouchStyle.None
  TakeOn.side[eid] = 0
  TakeOn.feintTimer[eid] = 0
  TakeOn.checkBackTimer[eid] = 0
  Shield.active[eid] = 0
  Shield.timer[eid] = 0
}

/**
 * `eid` becomes the player engaging the ball for their team. They already
 * know where it is, and may challenge once `delay` seconds have passed.
 */
export function engage(world: Match, eid: number, delay: number) {
  setPresser(world, eid)
  Dribbler.style[eid] = TouchStyle.None
  const mode = Defender.mode[eid]
  if (mode !== DefenderMode.SlideTackle && mode !== DefenderMode.Grounded) Defender.mode[eid] = DefenderMode.Run
  Defender.readX[eid] = Position.x[world.ball]
  Defender.readY[eid] = Position.y[world.ball]
  Defender.readVx[eid] = Velocity.x[world.ball]
  Defender.readVy[eid] = Velocity.y[world.ball]
  Defender.challengeDelay[eid] = delay
}

/** The outfielder of `team` who would get to (x, y) first; players on the ground don't count. */
export function quickestTo(world: Match, team: number, x: number, y: number, exclude = -1): number {
  let best = -1
  let bestTime = Infinity
  for (const eid of world.teams[team].outfielders) {
    if (eid === exclude || hasComponent(world, eid, Sliding)) continue
    const time = arrivalTime(world, eid, x, y, CONTROL_REACH)
    if (time < bestTime) {
      best = eid
      bestTime = time
    }
  }
  return best === -1 ? world.teams[team].outfielders[0] : best
}

/** Moves the OnBall tag to `eid`. */
function setCarrier(world: Match, eid: number) {
  // Who's free to be marked has changed: share the marking out again now.
  world.nextMarking = [0, 0]
  for (const other of query(world, [OnBall])) {
    if (other === eid) continue
    removeComponent(world, other, OnBall)
    stepOffBall(world, other)
  }
  if (hasComponent(world, eid, Pressing)) removeComponent(world, eid, Pressing)
  addComponent(world, eid, OnBall)
  // On the ball, they've stopped running and calling for it.
  clearIntentions(eid)
  world.carrier = eid
}

/** Moves the Pressing tag to `eid`. */
function setPresser(world: Match, eid: number) {
  world.nextMarking = [0, 0]
  for (const other of query(world, [Pressing])) {
    if (other === eid) continue
    removeComponent(world, other, Pressing)
    stepOffBall(world, other)
  }
  if (hasComponent(world, eid, OnBall)) removeComponent(world, eid, OnBall)
  addComponent(world, eid, Pressing)
  world.presser = eid
}

/**
 * A player leaving the ball or the press: they hold where they are while they
 * take stock, rather than picking up an off-ball plan from before.
 */
function stepOffBall(world: Match, eid: number) {
  clearIntentions(eid)
  OffBall.targetX[eid] = Position.x[eid]
  OffBall.targetY[eid] = Position.y[eid]
  OffBall.radius[eid] = 1
  OffBall.settled[eid] = 0
  OffBall.decideIn[eid] = Math.min(OffBall.decideIn[eid], TURNOVER_REACTION + world.rng() * TURNOVER_REACTION)
}

/** `player` wins the ball for their team in open play, and they go the other way. */
export function winBall(world: Match, player: number, kind: 'tackled' | 'intercepted') {
  const team = Team.id[player]
  world.stats[team].won++
  // The winner played it last, so a ball that runs out straight away goes against them.
  world.lastTouchedBy = player
  world.lastTouchDeliberate = kind === 'intercepted'
  setPossession(world, team, player)
  // Winning it is their team playing the ball: offside is judged for them from here.
  playedBy(world, player)
  record(world, kind, team)
}

/** Settles a shot: tallies it for the shooting team, then stops play or plays on. */
export function endShot(world: Match, outcome: ShotOutcome, crossing: GoalPoint | null) {
  const shot = world.shot
  if (!shot) return
  // A shot straight in from an indirect free kick doesn't count: it's as good as wide.
  if (outcome === 'goal' && world.indirectTaker !== -1) outcome = 'wide'
  shot.crossing = crossing
  const stats = world.stats[shot.team]
  if (outcome === 'goal') stats.goals++
  else if (outcome === 'caught' || outcome === 'parried') stats.saved++
  else stats.missed++

  const defending = opponent(shot.team)
  if (outcome === 'goal') stopPlay(world, 'kick-off', defending, 0, 0)
  else if (outcome === 'caught') takeInHands(world, world.keeper)
  else if (outcome === 'parried' || outcome === 'blocked') {
    // Play goes on, so the shot is history: guides and the goal view follow the live attack again.
    world.shot = null
    setPhase(world, 'play')
  }
  else stopPlay(world, 'goal-kick', defending, 0, 0)
  record(world, outcome, shot.team)
}

/** A goal that went in without a shot being struck: counted as one, so goals stay a share of shots. */
export function scoreFromPlay(world: Match, team: number) {
  // Straight in from an indirect free kick, nobody else touching it: a goal kick, not a goal.
  if (world.indirectTaker !== -1) return ballOut(world, 'goal-kick', opponent(team), attackedGoalX(team), 0)
  world.stats[team].shots++
  world.stats[team].goals++
  stopPlay(world, 'kick-off', opponent(team), 0, 0)
  record(world, 'goal', team)
}

/** A keeper gathers a loose ball. */
export function keeperClaims(world: Match, keeper: number) {
  const team = Team.id[keeper]
  if (team !== world.possession) world.stats[team].won++
  takeInHands(world, keeper)
  record(world, 'claimed', team)
}

/** The ball is in the keeper's hands: their team has it, and play waits on them to roll it out. */
function takeInHands(world: Match, keeper: number) {
  const team = Team.id[keeper]
  world.pass = null
  world.nextMarking = [0, 0]
  setVec(Velocity, world.ball, 0, 0, 0)
  if (team !== world.possession) setPossession(world, team, quickestTo(world, team, Position.x[keeper], Position.y[keeper]))
  setPhase(world, 'held')
}

/** The ball has gone out: play stops, and `team` restarts from about (x, y). */
/** `offender` was offside and got involved: the other team has an indirect free kick where they were. */
export function offsideCalled(world: Match, offender: number) {
  const team = Team.id[offender]
  world.stats[team].offsides++
  stopPlay(world, 'free-kick', opponent(team), Position.x[offender], Position.y[offender])
  record(world, 'offside', team)
}

export function ballOut(world: Match, kind: Exclude<RestartKind, 'kick-off' | 'free-kick'>, team: number, x: number, y: number) {
  stopPlay(world, kind, team, x, y)
  record(world, 'out', team)
}

function stopPlay(world: Match, kind: RestartKind, team: number, x: number, y: number) {
  world.pass = null
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
  } else if (kind === 'free-kick') {
    bx = clamp(restart.x, -L + 1, L - 1)
    by = clamp(restart.y, -W + 1, W - 1)
    standOff = FREE_KICK_DISTANCE
  }
  const faceLen = Math.hypot(faceX, faceY)
  faceX /= faceLen
  faceY /= faceLen

  for (const eid of [...world.teams[0].outfielders, ...world.teams[1].outfielders]) {
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
    Goalkeeper.recover[keeper] = 0
  }

  setVec(Position, ball, bx, by, BALL_RADIUS)
  setVec(Velocity, ball, 0, 0, 0)
  // Both lines start where they'd naturally be, and the marking is shared out at once.
  for (const t of [0, 1]) {
    world.lines[t] = baseLine(world, t)
    world.nextMarking[t] = 0
    world.trap[t] = 0
  }
  world.possession = team
  // Whoever's place in the shape is nearest the ball takes it: the pivot kicks off, a wide player takes the throw.
  const taker = nearestHome(world, team, bx, by)
  setVec(Position, taker, bx - faceX * 0.5, by - faceY * 0.5, 0)
  Facing.angle[taker] = Math.atan2(faceY, faceX)
  Dribbler.cooldown[taker] = 0

  // Everyone else takes up their place in the shape around the ball: the side
  // without it first, since the attackers' shape depends on where they stand.
  for (const t of [opponent(team), team]) {
    for (const eid of world.teams[t].outfielders) {
      if (eid === taker) continue
      const home = restartSpot(world, eid, kind, bx, by, t === team ? 0 : standOff)
      setVec(Position, eid, home.x, home.y, 0)
      Facing.angle[eid] = Math.atan2(by - home.y, bx - home.x)
    }
  }
  // Everyone holds where they've been put until they've had a look around, with no run or call carried over.
  for (const eid of [...world.teams[0].outfielders, ...world.teams[1].outfielders]) {
    clearIntentions(eid)
    Run.burstAt[eid] = 0
    OffBall.targetX[eid] = Position.x[eid]
    OffBall.targetY[eid] = Position.y[eid]
    OffBall.radius[eid] = 1
    OffBall.settled[eid] = 1
  }

  // The nearest opponent stands off towards the goal the taker attacks, a little to one side.
  const other = quickestTo(world, opponent(team), bx, by)
  const gx = goalX - bx
  const gy = -by
  const gLen = Math.hypot(gx, gy) || 1
  const lateral = (rng() * 2 - 1) * 1.5
  const ox = kind === 'kick-off' ? dir * standOff : bx + (gx / gLen) * standOff - (gy / gLen) * lateral
  const oy = kind === 'kick-off' ? lateral : by + (gy / gLen) * standOff + (gx / gLen) * lateral
  setVec(Position, other, clamp(ox, -L + 1, L - 1), clamp(oy, -W + 1, W - 1), 0)
  Facing.angle[other] = Math.atan2(by - Position.y[other], bx - Position.x[other])

  world.shot = null
  world.pass = null
  world.windup = null
  // Nobody can be offside from a throw-in, a corner or a goal kick.
  clearOffside(world)
  world.offsideExempt = kind === 'throw-in' || kind === 'corner' || kind === 'goal-kick'
  world.indirectTaker = kind === 'free-kick' ? taker : -1
  world.lastTouch = null
  world.lastChallenge = null
  world.lastTouchedBy = taker
  world.lastTouchDeliberate = true
  world.restart = null
  setPossession(world, team, taker)
  Defender.mode[world.presser] = DefenderMode.Jockey
  Defender.challengeDelay[world.presser] = 0
  setPhase(world, 'play')
}

/** The outfielder of `team` whose place in the shape is nearest (x, y). */
function nearestHome(world: Match, team: number, x: number, y: number): number {
  let best = world.teams[team].outfielders[0]
  let bestDistance = Infinity
  for (const eid of world.teams[team].outfielders) {
    const home = homePosition(world, eid)
    const distance = Math.hypot(home.x - x, home.y - y)
    if (distance < bestDistance) {
      best = eid
      bestDistance = distance
    }
  }
  return best
}

/**
 * Where a player not taking the restart stands for it: their place in the
 * shape, in their own half for a kick-off, and at least `standOff` metres
 * from the ball.
 */
function restartSpot(world: Match, eid: number, kind: RestartKind, bx: number, by: number, standOff: number) {
  const team = Team.id[eid]
  let { x, y } = homePosition(world, eid)
  if (kind === 'kick-off' && x * attackDir(team) > -1) x = -attackDir(team)
  const dx = x - bx
  const dy = y - by
  const distance = Math.hypot(dx, dy)
  if (distance < standOff) {
    // Step back towards their own goal, which also keeps a kick-off opponent out of the circle.
    const awayX = distance > 0.5 ? dx / distance : -attackDir(team)
    const awayY = distance > 0.5 ? dy / distance : 0
    x = bx + awayX * standOff
    y = by + awayY * standOff
  }
  return { x: clamp(x, -PITCH_HALF_LENGTH + 1, PITCH_HALF_LENGTH - 1), y: clamp(y, -PITCH_HALF_WIDTH + 1, PITCH_HALF_WIDTH - 1) }
}

export function requestShot(world: Match) {
  if (world.phase === 'play') world.shootRequested = true
}

/** The carrier's current spread circle, before or after the shot: where most of their shots from here would go. */
export function currentSpread(world: Match): number {
  return world.shot ? world.shot.radius : 2 * planShot(world, world.carrier).miss
}

export function setPhase(world: Match, phase: Phase) {
  world.phase = phase
  world.phaseTime = 0
}

/**
 * The systems a step runs, in order: the decisions first, from who has which
 * role to where everyone wants to go, then the physics that carries them out.
 * Named so a profiler can time each one.
 */
export const MATCH_SYSTEMS: readonly (readonly [string, (world: Match, dt: number) => void])[] = [
  ['touchCooldown', touchCooldownSystem],
  ['balance', balanceSystem],
  ['roles', rolesSystem],
  ['defending', defendingSystem],
  ['carrier', carrierSystem],
  ['defender', defenderSystem],
  ['offBall', offBallSystem],
  ['receive', receiveSystem],
  ['touch', touchSystem],
  ['locomotion', locomotionSystem],
  ['challenge', challengeSystem],
  ['keeper', keeperSystem],
  ['collision', collisionSystem],
  ['ball', ballSystem],
  ['ballBody', ballBodySystem],
  ['contest', contestSystem],
  ['outcome', outcomeSystem],
]

export function stepMatch(world: Match, dt: number = FIXED_DT) {
  world.time += dt
  world.phaseTime += dt
  for (const [, system] of MATCH_SYSTEMS) system(world, dt)
  // Anyone else touching the ball makes an indirect free kick live.
  if (world.indirectTaker !== -1 && world.lastTouchedBy !== world.indirectTaker) world.indirectTaker = -1
}

export function setVec(store: typeof Position, eid: number, x: number, y: number, z: number) {
  store.x[eid] = x
  store.y[eid] = y
  store.z[eid] = z
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))


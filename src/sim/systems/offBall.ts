import { hasComponent, query } from 'bitecs'
import { Defender, DefenderMode, Effort, MoveIntent, OffBall, Outfielder, Position, Sliding, Team } from '../components'
import { PITCH_HALF_LENGTH, PITCH_HALF_WIDTH } from '../constants'
import type { Match } from '../match'
import { setTarget, steer } from '../movement'
import { along, homePosition, onsideLimit } from '../shape'
import { attackDir, ownGoalX } from '../teams'

/** Players reconsider every DECIDE_EVERY seconds, plus up to DECIDE_SPREAD, so the team doesn't move in lockstep. */
const DECIDE_EVERY = 0.25
const DECIDE_SPREAD = 0.2

/** Attackers keep at least this far (m) from the carrier, so they offer a pass rather than crowd them. */
const SPACING = 0.16 * 2 * PITCH_HALF_LENGTH
/** A target counts as reached within BASE_RADIUS, growing by RADIUS_PER_METRE for every metre from the ball. */
const BASE_RADIUS = 1.2
const RADIUS_PER_METRE = 0.06

/** The covering defender sits this far (m) behind the ball, towards goal, and this far across towards the free attacker. */
const COVER_DEPTH = 5.5
const COVER_SHADE = 3
/** Attackers aim to stay this far (m) onside of the opposition's line. */
const ONSIDE_MARGIN = 1
/** Teammates' targets stay at least this far (m) apart, so two players never do one job. */
const TEAMMATE_GAP = 4
/** A marker stands between MARK_TIGHT and MARK_LOOSE metres goal-side of their man, tighter the nearer the ball. */
const MARK_TIGHT = 1.5
const MARK_LOOSE = 4
const MARK_LOOSE_AT = 20
/** A marker shades this far (m) towards the ball, to see it and cut the pass. */
const MARK_BALL_SHADE = 1
/**
 * How far nearer to goal than the ball (m) the free attacker must get before
 * the covering defender picks them up entirely, and how far behind the ball
 * before they cover the presser instead.
 */
const MARK_WHEN_AHEAD = 2
const COVER_WHEN_BEHIND = 5

/**
 * The outfielders without a job on the ball: the carrier's teammates keep
 * the team's shape and offer an option, and the presser's teammates cover
 * and mark. While a keeper holds the ball everyone is off it: the keeper's
 * team spreads out to receive, and the other side picks up a man each.
 */
export function offBallSystem(world: Match, dt: number) {
  for (const eid of query(world, [OffBall, Outfielder, MoveIntent, Position])) {
    // A tackle, slide or getting up plays out first; the challenge system owns it.
    const mode = Defender.mode[eid]
    if (hasComponent(world, eid, Sliding) || (mode !== DefenderMode.Jockey && mode !== DefenderMode.Run)) continue
    const held = world.phase === 'held'
    if (!held && (eid === world.carrier || eid === world.presser)) continue
    const attacking = Team.id[eid] === world.possession
    const ball = world.ball
    if (world.phase === 'stopped') {
      MoveIntent.vx[eid] = MoveIntent.vy[eid] = 0
      MoveIntent.faceX[eid] = Position.x[ball] - Position.x[eid]
      MoveIntent.faceY[eid] = Position.y[ball] - Position.y[eid]
      continue
    }

    OffBall.decideIn[eid] -= dt
    if (OffBall.decideIn[eid] <= 0) {
      OffBall.decideIn[eid] = DECIDE_EVERY + world.rng() * DECIDE_SPREAD
      if (attacking) support(world, eid)
      else cover(world, eid)
    }
    const face = attacking ? halfTurn(world, eid) : { x: Position.x[ball] - Position.x[eid], y: Position.y[ball] - Position.y[eid] }
    steer(eid, face.x, face.y)
  }
}

/**
 * Take up their place in the shape, kept clear of the carrier. While their
 * keeper has the ball, the shape itself spreads them out to receive it.
 */
function support(world: Match, eid: number) {
  let { x, y } = homePosition(world, eid)
  const carrier = world.carrier
  if (world.phase !== 'held' && carrier !== eid) {
    const dx = x - Position.x[carrier]
    const dy = y - Position.y[carrier]
    const gap = Math.hypot(dx, dy)
    if (gap < SPACING) {
      // Slide away from the carrier, keeping on the side they're already on.
      const ux = gap > 0.5 ? dx / gap : 0
      const uy = gap > 0.5 ? dy / gap : Math.sign(y - Position.y[carrier]) || 1
      x = Position.x[carrier] + ux * SPACING
      y = Position.y[carrier] + uy * SPACING
    }
  }
  x = clamp(x, -PITCH_HALF_LENGTH + 1.5, PITCH_HALF_LENGTH - 1.5)
  y = clamp(y, -PITCH_HALF_WIDTH + 1.5, PITCH_HALF_WIDTH - 1.5)
  go(world, eid, x, y, effortFor(world, eid, x, y, false))
}

/**
 * Cover the presser or mark the free attacker. The defender sits behind the
 * ball, ready to step in if the presser is beaten. As the free attacker gets
 * nearer goal than the ball, the defender slides across to pick them up,
 * goal-side and a little towards the ball. Behind the ball the attacker is
 * less of a threat and can be left until they come forward.
 */
function cover(world: Match, eid: number) {
  const ball = world.ball
  const goalX = ownGoalX(Team.id[eid])
  const bx = Position.x[ball]
  const by = Position.y[ball]
  const man = markedBy(world, eid)
  const toGoal = unit(goalX - bx, -by)
  let x = bx + toGoal.x * COVER_DEPTH
  let y = by + toGoal.y * COVER_DEPTH
  if (man !== -1) {
    const mx = Position.x[man]
    const my = Position.y[man]
    // Covering: shade across towards the side the free attacker is on.
    const side = Math.sign(-(mx - bx) * toGoal.y + (my - by) * toGoal.x)
    x += -toGoal.y * side * COVER_SHADE
    y += toGoal.x * side * COVER_SHADE
    // Marking: goal-side of them, tighter the nearer they are to the ball.
    const manToGoal = unit(goalX - mx, -my)
    const manToBall = unit(bx - mx, by - my)
    const tightness = clamp(Math.hypot(bx - mx, by - my) / MARK_LOOSE_AT, 0, 1)
    const depth = MARK_TIGHT + (MARK_LOOSE - MARK_TIGHT) * tightness
    const markX = mx + manToGoal.x * depth + manToBall.x * MARK_BALL_SHADE
    const markY = my + manToGoal.y * depth + manToBall.y * MARK_BALL_SHADE
    const ahead = Math.hypot(goalX - bx, by) - Math.hypot(goalX - mx, my)
    const w = clamp((ahead + COVER_WHEN_BEHIND) / (MARK_WHEN_AHEAD + COVER_WHEN_BEHIND), 0, 1)
    x += (markX - x) * w
    y += (markY - y) * w
  }
  // Never behind their own goal line.
  const dir = attackDir(Team.id[eid])
  x = clamp(x, -PITCH_HALF_LENGTH + 1, PITCH_HALF_LENGTH - 1)
  if ((x - goalX) * dir < 1) x = goalX + dir
  y = clamp(y, -PITCH_HALF_WIDTH + 1, PITCH_HALF_WIDTH - 1)
  go(world, eid, x, y, effortFor(world, eid, x, y, true))
}

/**
 * The attacker `eid` is responsible for: defenders pair off with the
 * attackers not already engaged, each with the nearest one left. While the
 * keeper holds the ball nobody is engaged, so every attacker is picked up.
 */
function markedBy(world: Match, eid: number): number {
  const team = Team.id[eid]
  const held = world.phase === 'held'
  const defenders = world.teams[team].outfielders.filter((d) => held || d !== world.presser)
  const attackers = world.teams[world.possession].outfielders.filter((a) => held || a !== world.carrier)
  // Greedy pairing, closest pair first.
  const pairs: [number, number, number][] = []
  for (const d of defenders) for (const a of attackers) pairs.push([Math.hypot(Position.x[a] - Position.x[d], Position.y[a] - Position.y[d]), d, a])
  pairs.sort((p, q) => p[0] - q[0])
  const takenD = new Set<number>()
  const takenA = new Set<number>()
  for (const [, d, a] of pairs) {
    if (takenD.has(d) || takenA.has(a)) continue
    if (d === eid) return a
    takenD.add(d)
    takenA.add(a)
  }
  return -1
}

/**
 * How hard to work to get there: a sprint to recover when a defender is on
 * the wrong side of the ball, otherwise as hard as the distance calls for.
 */
function effortFor(world: Match, eid: number, x: number, y: number, defending: boolean): Effort {
  const distance = Math.hypot(x - Position.x[eid], y - Position.y[eid])
  if (defending) {
    const goalX = ownGoalX(Team.id[eid])
    const ball = world.ball
    const beaten = Math.hypot(goalX - Position.x[eid], Position.y[eid]) > Math.hypot(goalX - Position.x[ball], Position.y[ball]) + 1
    if (beaten && distance > 3) return Effort.Sprint
  }
  if (distance > 10) return Effort.Run
  if (distance > 3) return Effort.Jog
  return Effort.Walk
}

function go(world: Match, eid: number, x: number, y: number, effort: Effort) {
  ;({ x, y } = apart(world, eid, x, y))
  // Whatever moved it, an attacker's target stays onside.
  const team = Team.id[eid]
  if (team === world.possession) {
    const limit = onsideLimit(world, team) - ONSIDE_MARGIN
    if (along(team, x) > limit) x = limit * attackDir(team)
  }
  const ball = world.ball
  const radius = BASE_RADIUS + RADIUS_PER_METRE * Math.hypot(x - Position.x[ball], y - Position.y[ball])
  setTarget(eid, x, y, radius, effort)
}

/**
 * Pushes a target out of teammates' way: away from where each teammate is
 * heading, or from where they are if they're on the ball or pressing it.
 */
function apart(world: Match, eid: number, x: number, y: number) {
  for (const mate of world.teams[Team.id[eid]].outfielders) {
    if (mate === eid) continue
    const onBall = world.phase !== 'held' && (mate === world.carrier || mate === world.presser)
    const mx = onBall ? Position.x[mate] : OffBall.targetX[mate]
    const my = onBall ? Position.y[mate] : OffBall.targetY[mate]
    const gap = Math.hypot(x - mx, y - my)
    if (gap >= TEAMMATE_GAP) continue
    // Straight away from them, or sideways if right on top of them.
    const ux = gap > 0.1 ? (x - mx) / gap : 0
    const uy = gap > 0.1 ? (y - my) / gap : Math.sign(y - my) || 1
    x = mx + ux * TEAMMATE_GAP
    y = my + uy * TEAMMATE_GAP
  }
  return {
    x: clamp(x, -PITCH_HALF_LENGTH + 1, PITCH_HALF_LENGTH - 1),
    y: clamp(y, -PITCH_HALF_WIDTH + 1, PITCH_HALF_WIDTH - 1),
  }
}

/** Half-turned: between facing the ball and facing the goal they attack, so they can receive and go forward. */
function halfTurn(world: Match, eid: number) {
  const toBall = unit(Position.x[world.ball] - Position.x[eid], Position.y[world.ball] - Position.y[eid])
  return { x: toBall.x + attackDir(Team.id[eid]), y: toBall.y }
}

function unit(x: number, y: number) {
  const length = Math.hypot(x, y)
  return length > 1e-6 ? { x: x / length, y: y / length } : { x: 0, y: 0 }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

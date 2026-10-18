import { hasComponent, query } from 'bitecs'
import { Defender, DefenderMode, Effort, Mark, MoveIntent, OffBall, Outfielder, Position, Run, RunPhase, Sliding, Team } from '../components'
import { attackingIntent, endRun, tickRun } from '../attacking'
import { coverSpot, lineTarget, pressCue, trapping } from './defending'
import type { Match } from '../match'
import { view, type View } from '../perception'
import { setTarget, steer } from '../movement'
import { along, homePosition, onsideLimit } from '../shape'
import { attackDir, ownGoalX } from '../teams'

/**
 * Players reconsider every DECIDE_EVERY seconds, plus up to DECIDE_SPREAD, so
 * the team doesn't move in lockstep. That's near the ball; further from it
 * they're less involved and look again less often, up to FAR_EVERY plus
 * FAR_SPREAD seconds by FAR_FROM_BALL metres away. Something happening, such
 * as the ball being played, makes them look sooner (see `cue`).
 */
const DECIDE_EVERY = 0.25
const DECIDE_SPREAD = 0.2
const FAR_EVERY = 0.7
const FAR_SPREAD = 0.4
const NEAR_BALL = 12
const FAR_FROM_BALL = 30

/** A target counts as reached within BASE_RADIUS, growing by RADIUS_PER_METRE for every metre from the ball. */
const BASE_RADIUS = 1.2
const RADIUS_PER_METRE = 0.06

/** A defender covering and marking at once shades this far (m) across towards their man. */
const COVER_SHADE = 3
/** Attackers aim to stay this far (m) onside of the opposition's line, or RUNNER_MARGIN when running in behind. */
const ONSIDE_MARGIN = 1
const RUNNER_MARGIN = 0.2
/** A runner's or a check-away's target counts as reached only this close (m). */
const RUNNER_RADIUS = 0.3
/** Teammates' targets stay at least this far (m) apart, so two players never do one job. */
const TEAMMATE_GAP = 4
/** A marker stands between MARK_TIGHT and MARK_LOOSE metres goal-side of their man, tighter the nearer the ball. */
const MARK_TIGHT = 1.5
const MARK_LOOSE = 4
const MARK_LOOSE_AT = 20
/** A marker shades this far (m) towards the ball, to see it and cut the pass. */
const MARK_BALL_SHADE = 1
/**
 * How far nearer to goal than the ball (m) a man must get before their
 * marker picks them up entirely, and how far behind the ball before the
 * marker leaves them to their zone.
 */
const MARK_WHEN_AHEAD = 2
const MARK_FROM_BEHIND = 5

/** Scratch for where a marker reckons their man is. */
const seen: View = { x: 0, y: 0, vx: 0, vy: 0, facing: 0 }

/**
 * The outfielders without a job on the ball: the carrier's teammates hold
 * the shape, show for it or run in behind (see `attackingIntent`), and the
 * presser's teammates do the jobs their team has shared out (see `defend`). While a keeper holds the ball everyone is off it: the keeper's
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

    if (attacking) tickRun(eid, dt)
    else endRun(world, eid)
    OffBall.decideIn[eid] -= dt
    if (OffBall.decideIn[eid] <= 0) {
      if (attacking) {
        const intent = attackingIntent(world, eid)
        go(world, eid, intent.x, intent.y, intent.effort)
      } else defend(world, eid)
      // How soon they look again depends on what they've just decided: setting off on a run keeps them alert.
      OffBall.decideIn[eid] = nextLook(world, eid)
    }
    const face = attacking ? halfTurn(world, eid) : { x: Position.x[ball] - Position.x[eid], y: Position.y[ball] - Position.y[eid] }
    steer(eid, face.x, face.y)
  }
}

/**
 * Seconds until `eid` looks again: soon when they're involved, with the ball
 * near them or their man, or on a run or showing for it; less often the
 * further away the play is.
 */
function nextLook(world: Match, eid: number): number {
  const ball = world.ball
  const bx = Position.x[ball]
  const by = Position.y[ball]
  let distance = Math.hypot(Position.x[eid] - bx, Position.y[eid] - by)
  const man = Mark.target[eid]
  if (man !== -1) {
    view(world, eid, man, seen)
    distance = Math.min(distance, Math.hypot(seen.x - bx, seen.y - by))
  }
  if (Run.phase[eid] !== RunPhase.None || OffBall.showing[eid]) distance = 0
  const far = clamp((distance - NEAR_BALL) / (FAR_FROM_BALL - NEAR_BALL), 0, 1)
  const every = DECIDE_EVERY + (FAR_EVERY - DECIDE_EVERY) * far
  const spread = DECIDE_SPREAD + (FAR_SPREAD - DECIDE_SPREAD) * far
  return every + world.rng() * spread
}

/**
 * Does the job the team has given them. The cover stands behind the ball,
 * between it and the middle of the goal, ready to step in if the presser is
 * beaten. Everyone else starts from their place in the block, which slides
 * with the ball and keeps the team compact. A defender with a man moves off
 * that place to pick him up as he becomes a threat: goal-side of him once
 * he's nearer goal than the ball, tighter the nearer he is to it. A man well
 * behind the ball is watched from the zone, not followed. They mark him
 * where they reckon he is: a man who has slipped out of sight is marked where
 * he was last seen, heading the way he was going, until they look again.
 */
function defend(world: Match, eid: number) {
  const ball = world.ball
  const team = Team.id[eid]
  const goalX = ownGoalX(world.pitch, team)
  const bx = Position.x[ball]
  const by = Position.y[ball]
  let { x, y } = Mark.cover[eid] ? coverSpot(world, team) : homePosition(world, eid)
  const man = Mark.target[eid]
  if (man !== -1) {
    view(world, eid, man, seen)
    const mx = seen.x
    const my = seen.y
    if (Mark.cover[eid]) {
      // Covering and marking at once: shade across towards the side the man is on.
      const toGoal = unit(goalX - bx, -by)
      const side = Math.sign(-(mx - bx) * toGoal.y + (my - by) * toGoal.x)
      x += -toGoal.y * side * COVER_SHADE
      y += toGoal.x * side * COVER_SHADE
    }
    // Goal-side of them, tighter the nearer they are to the ball, shading towards it to see it and cut the pass.
    const manToGoal = unit(goalX - mx, -my)
    const manToBall = unit(bx - mx, by - my)
    // On a pressing cue they get tight, to deny the pass.
    const tightness = pressCue(world) ? 0 : clamp(Math.hypot(bx - mx, by - my) / MARK_LOOSE_AT, 0, 1)
    const depth = MARK_TIGHT + (MARK_LOOSE - MARK_TIGHT) * tightness
    const markX = mx + manToGoal.x * depth + manToBall.x * MARK_BALL_SHADE
    const markY = my + manToGoal.y * depth + manToBall.y * MARK_BALL_SHADE
    const ahead = Math.hypot(goalX - bx, by) - Math.hypot(goalX - mx, my)
    const w = clamp((ahead + MARK_FROM_BEHIND) / (MARK_WHEN_AHEAD + MARK_FROM_BEHIND), 0, 1)
    x += (markX - x) * w
    y += (markY - y) * w
  }
  // Never behind their own goal line.
  const dir = attackDir(team)
  x = clamp(x, -world.pitch.halfLength + 1, world.pitch.halfLength - 1)
  if ((x - goalX) * dir < 1) x = goalX + dir
  y = clamp(y, -world.pitch.halfWidth + 1, world.pitch.halfWidth - 1)
  go(world, eid, x, y, effortFor(world, eid, x, y, true))
}

/**
 * How hard to work to get there: a sprint to recover when a defender is on
 * the wrong side of the ball, otherwise as hard as the distance calls for.
 */
function effortFor(world: Match, eid: number, x: number, y: number, defending: boolean): Effort {
  const distance = Math.hypot(x - Position.x[eid], y - Position.y[eid])
  if (defending) {
    const goalX = ownGoalX(world.pitch, Team.id[eid])
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
  const team = Team.id[eid]
  const attacking = team === world.possession
  const ball = world.ball
  // Defenders hold the line rather than drop behind it, unless the ball is already beyond it or a pass is on
  // its way: a runner who goes past them before the pass is offside. Springing the trap, they make for where
  // the line is going.
  const trap = !attacking && trapping(world, team)
  if (!attacking) {
    const line = trap ? lineTarget(world, team) : world.lines[team]
    if (world.phase === 'play' && !world.pass && along(team, x) < line && along(team, Position.x[ball]) > line + 2) {
      x = line * attackDir(team)
      // Pinned to the line, they keep clear of teammates by sliding along it instead.
      for (const mate of world.teams[team].outfielders) {
        if (mate === eid) continue
        const onBall = mate === world.presser
        const mx = onBall ? Position.x[mate] : OffBall.targetX[mate]
        const my = onBall ? Position.y[mate] : OffBall.targetY[mate]
        const dx = x - mx
        if (Math.abs(dx) >= TEAMMATE_GAP) continue
        const side = Math.sign(y - my) || 1
        const need = Math.sqrt(TEAMMATE_GAP * TEAMMATE_GAP - dx * dx)
        if (Math.abs(y - my) < need) y = clamp(my + side * need, -world.pitch.halfWidth + 1, world.pitch.halfWidth - 1)
      }
    }
  }
  // A runner wants to be right on the line, a check away is a short, deliberate step, and a trap is a step up
  // together: all need a tight aim, so they move even from standing.
  const precise = (attacking && Run.phase[eid] !== RunPhase.None) || trap
  const radius = precise ? RUNNER_RADIUS : BASE_RADIUS + RADIUS_PER_METRE * Math.hypot(x - Position.x[ball], y - Position.y[ball])
  // The trap is sprung sharply.
  setTarget(eid, x, y, radius, trap ? Math.max(effort, Effort.Run) as Effort : effort)
  // Whatever the target ends up being, an attacker's stays onside: a runner on the last
  // defender's shoulder, everyone else a yard short, except a runner bursting for a
  // through ball being shaped for them.
  if (attacking) {
    const limit = onsideLimit(world, team) - (Run.phase[eid] === RunPhase.Go ? RUNNER_MARGIN : ONSIDE_MARGIN)
    const bursting = world.windup?.option.receiver === eid && world.windup.option.kind === 'through' && world.time >= Run.burstAt[eid]
    if (!bursting && along(team, OffBall.targetX[eid]) > limit) OffBall.targetX[eid] = limit * attackDir(team)
  }
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
    x: clamp(x, -world.pitch.halfLength + 1, world.pitch.halfLength - 1),
    y: clamp(y, -world.pitch.halfWidth + 1, world.pitch.halfWidth - 1),
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

import { Carry, Outfielder, Position, Team, Velocity } from './components'
import { tackleSkill } from './grades'
import type { Match } from './match'
import { seenX, seenY } from './perception'
import { arrivalTime, REACTION_TIME } from './space/arrival'
import { teamArrival } from './space/control'
import { threat } from './space/threat'
import { attackedGoalX, opponent } from './teams'
import { roomAhead } from './touch'
import { atan2, cos, exp, hypot, sin } from './fmath'

/** Directions a carrier weighs up, spread evenly round them, starting towards goal. */
const DIRECTIONS = 16
/** How far (m) ahead a carry is judged: a second or so with the ball. */
const CARRY_REACH = 6
/** An opponent who gets within this distance (m) of the ball is on them. */
const CHALLENGE_REACH = 1.2
/** How sharply (s) an opponent's lead in getting there turns into being caught. */
const CAUGHT_SCALE = 0.3
/**
 * Caught, the carrier has to beat their man to keep it: the defender wins
 * it this share of the times a timed tackle would (see `tackleSkill`), as
 * not every challenge gets a clean go at the ball.
 */
const TACKLE_SHARE = 0.8
/** Carrying it away from the presser, the share of his chance of winning it that's left. */
const SHIELDED_SHARE = 0.35
/**
 * A defender no further ahead than CARRY_REACH, and within IN_THE_WAY (m) of
 * the carry's line and IN_THE_WAY_SLOPE of it per metre ahead (about 30°),
 * is in the way: going that way means going through him.
 */
const IN_THE_WAY = 2
const IN_THE_WAY_SLOPE = 0.6
/**
 * A direction needs room for the carry and for pulling up or turning at the
 * end of it: the ground covered in this long (s) at the speed they're going.
 */
const TURN_TIME = 0.6
/** Rethink this often (s). */
const DECIDE_EVERY = 0.25

/** A carry a carrier could make, and how likely they are to keep the ball on it. */
export interface CarryPlan {
  /** Unit direction to carry it. */
  dirX: number
  dirY: number
  /** Whether that means taking on the defender in the way. */
  takeOn: boolean
  /** Chance they still have the ball at the end of it. */
  kept: number
}

/**
 * Where a carrier keeping the ball would best take it, as they see it, and
 * whether that means taking on the defender in the way. Each direction is
 * worth the threat where the carry would end up if they get there, less the
 * other team's threat from here if they're caught and lose it. They're
 * caught if an opponent they know of gets there first; caught, they keep it
 * only by beating their man, which the better dribbler against the worse
 * tackler does more often. So they go round pressure into space, and take a
 * man on only when beating him is worth the risk: near goal, against a
 * weaker tackler. With nobody in the way, they head straight for goal.
 */
export function planCarry(world: Match, carrier: number, plan: CarryPlan = { dirX: 0, dirY: 0, takeOn: false, kept: 1 }): CarryPlan {
  const team = Team.id[carrier]
  const them = opponent(team)
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  // The man they'd have to beat, where they reckon he is, and how likely he'd be to win it if they took him on.
  const presser = theirMan(world, carrier)
  const px = seenX(world, carrier, presser)
  const py = seenY(world, carrier, presser)
  const tackled = TACKLE_SHARE * tackleSkill(Outfielder.tackling[presser], Outfielder.dribbling[carrier])
  const lost = threat(world.pitch, them, bx, by)
  const toGoal = atan2(-by, attackedGoalX(world.pitch, team) - bx)
  const needed = CARRY_REACH + TURN_TIME * hypot(Velocity.x[carrier], Velocity.y[carrier])

  let best = -Infinity
  plan.dirX = cos(toGoal)
  plan.dirY = sin(toGoal)
  plan.takeOn = false
  plan.kept = 1 - tackled
  for (let i = 0; i < DIRECTIONS; i++) {
    const angle = toGoal + (i / DIRECTIONS) * Math.PI * 2
    const dx = cos(angle)
    const dy = sin(angle)
    if (roomAhead(world.pitch, bx, by, dx, dy) < needed) continue
    const x = bx + dx * CARRY_REACH
    const y = by + dy * CARRY_REACH
    const lead = teamArrival(world, them, x, y, CHALLENGE_REACH, carrier) - arrivalTime(world, carrier, x, y, 0, 0, carrier)
    const caught = 1 / (1 + exp(lead / CAUGHT_SCALE))
    // Carried away from the presser, the body is between him and the ball, and he has to tackle from the side or behind.
    const towards = Math.max(0, ((px - bx) * dx + (py - by) * dy) / (hypot(px - bx, py - by) || 1))
    const kept = 1 - caught * tackled * (SHIELDED_SHARE + (1 - SHIELDED_SHARE) * towards)
    const value = kept * threat(world.pitch, team, x, y) - (1 - kept) * lost
    if (value <= best) continue
    best = value
    // Straight at the defender, it's a take-on.
    const along = (px - bx) * dx + (py - by) * dy
    const across = Math.abs(-(px - bx) * dy + (py - by) * dx)
    plan.dirX = dx
    plan.dirY = dy
    plan.takeOn = along > 0 && along < CARRY_REACH && across < Math.min(IN_THE_WAY, along * IN_THE_WAY_SLOPE)
    plan.kept = kept
  }
  return plan
}

/** The opponent `carrier` reckons will get to the ball first: the man they'd have to beat. */
function theirMan(world: Match, carrier: number): number {
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  let man = world.presser
  let soonest = Infinity
  for (const eid of world.teams[opponent(Team.id[carrier])].outfielders) {
    const time = arrivalTime(world, eid, bx, by, CHALLENGE_REACH, REACTION_TIME, carrier)
    if (time < soonest) {
      man = eid
      soonest = time
    }
  }
  return man
}

/** Scratch for the carrier's plan. */
const scratch: CarryPlan = { dirX: 0, dirY: 0, takeOn: false, kept: 1 }

/** The carrier keeping the ball rethinks where to take it, a few times a second (see `planCarry`). */
export function chooseCarry(world: Match, carrier: number) {
  if (world.time < Carry.nextLook[carrier]) return
  Carry.nextLook[carrier] = world.time + DECIDE_EVERY
  const plan = planCarry(world, carrier, scratch)
  if (world.onDecision && (plan.takeOn ? 1 : 0) !== Carry.takeOn[carrier]) {
    const heading = Math.round((atan2(plan.dirY, plan.dirX) * 180) / Math.PI)
    world.onDecision(carrier, plan.takeOn ? `takes their man on, heading ${heading}°: no way round him (reckons ${Math.round(plan.kept * 100)}% to keep it)` : `carries it on, heading ${heading}°: there's a way round`)
  }
  Carry.dirX[carrier] = plan.dirX
  Carry.dirY[carrier] = plan.dirY
  Carry.takeOn[carrier] = plan.takeOn ? 1 : 0
}

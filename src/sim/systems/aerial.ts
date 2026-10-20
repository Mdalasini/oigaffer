import { Dribbler, Outfielder, Physical, Position, Team, Velocity } from '../components'
import { cue } from '../cues'
import { atan2, cos, hypot, sin } from '../fmath'
import { BALL_RADIUS, GRAVITY } from '../constants'
import { loftFlightTime } from '../flight'
import { aerialDuelChance, headerCleanChance, headerReach } from '../grades'
import { handOver, winBall, type Match } from '../match'
import { offsideOffence, playBall } from '../offside'
import { gaussian } from '../rng'
import { HEADER_HEIGHT, timeOnBall } from '../space/control'
import { attackDir, opponent, ownGoalX } from '../teams'
import { AERIAL_REACH, canPlayBall } from '../touch'
import { claimingKeeper } from './keeper'
import { controlDroppingBall, received } from './receive'
import { playerLabel } from '../trace'

/** Below this height (m) the ball is at someone's feet, and taken or won as any other. */
const FEET_HEIGHT = 0.5
/** Once one of them is within reach, an attacker and a defender no more than this much further (m) apart from the ball jump together for it. */
const DUEL_RANGE = 1.2
/** How far (rad) a header cleared up the pitch strays from straight, and a glancing one from the way the ball was going. */
const CLEAR_SPREAD = 0.5
const GLANCE_SPREAD = 1.2
/** A glancing header goes up at up to this pace (m/s). */
const GLANCE_LIFT = 2
/** A header is headed on to a teammate at least this far (m) off, within this cosine of straight up the pitch. */
const HEADER_MIN = 3
const HEADER_CONE = 0.3
/** A header on to a teammate hangs this share of the time a lofted pass that far would. */
const HEADER_LOOP = 0.6
/** A glancing header goes off at between these paces (m/s). */
const GLANCE_SLOWEST = 2
const GLANCE_FASTEST = 6
/** Seconds after heading it before a player can play the ball again. */
const HEADER_RECOVER = 0.3

/**
 * A lofted pass coming down within reach is a contest in the air. When the
 * nearest attacker and the nearest defender are both there as it drops, the
 * two jump for it and the better in the air, and the stronger, tends to
 * win, though a defender goal-side of their man has the better of it. An attacker who wins it tries to
 * bring it down, with the defender on them; a defender who wins it, or has it to themselves, heads it away,
 * cleanly the better they head it (see `headClear`). A keeper who can get hands to it comes
 * first (see `outcome`); a ball low enough to be at someone's feet is
 * taken or won as any other.
 */
export function aerialSystem(world: Match, _dt: number) {
  const pass = world.pass
  if (!pass?.lofted || world.phase !== 'play') return
  const ball = world.ball
  const z = Position.z[ball]
  if (z <= FEET_HEIGHT || z > HEADER_HEIGHT) return
  if (claimingKeeper(world) !== -1) return

  const defender = nearestInAir(world, opponent(world.possession), AERIAL_REACH + DUEL_RANGE)
  if (defender === -1) return
  const attacker = nearestInAir(world, world.possession, AERIAL_REACH + DUEL_RANGE)
  const gap = (eid: number) => (eid === -1 ? Infinity : hypot(Position.x[ball] - Position.x[eid], Position.y[ball] - Position.y[eid]))
  const toDefender = gap(defender)
  const toAttacker = gap(attacker)
  // Nobody can get their head to it yet.
  if (Math.min(toDefender, toAttacker) > AERIAL_REACH) return
  if (Math.abs(toDefender - toAttacker) <= DUEL_RANGE) {
    // Jumping for it is being involved, won or lost.
    if (offsideOffence(world, attacker)) return
    const goal = ownGoalX(world.pitch, Team.id[defender])
    const goalSide = hypot(Position.x[defender] - goal, Position.y[defender]) < hypot(Position.x[attacker] - goal, Position.y[attacker])
    const won = aerialDuelChance(Outfielder.heading[attacker], Physical.strength[attacker], Outfielder.heading[defender], Physical.strength[defender], goalSide)
    world.onDecision?.(attacker, `jumps with ${playerLabel(world, defender)} for the ball in the air: wins it ${Math.round(won * 100)}% of the time`)
    if (world.rng() < won) {
      if (!playBall(world, attacker)) return
      if (attacker !== world.carrier) handOver(world, attacker)
      received(world, attacker, pass.from)
      controlDroppingBall(world, attacker, true)
      return
    }
    return headClear(world, defender)
  }
  // On their own under it: a defender heads it away, and an attacker brings it down (see `receive`).
  if (toDefender <= AERIAL_REACH) headClear(world, defender)
}

/** The outfielder of `team` nearest the ball, within `reach` (m) of it and able to play it; -1 if none is. */
function nearestInAir(world: Match, team: number, reach: number): number {
  const ball = world.ball
  let best = -1
  let nearest = reach
  for (const eid of world.teams[team].outfielders) {
    // Someone who has just played it, the passer among them, can't go straight back for it.
    if (!canPlayBall(world, eid) || Dribbler.cooldown[eid] > 0) continue
    const d = hypot(Position.x[ball] - Position.x[eid], Position.y[ball] - Position.y[eid])
    if (d <= nearest) {
      best = eid
      nearest = d
    }
  }
  return best
}

/**
 * `eid` heads the ball away. A clean header goes on to the teammate ahead
 * of them, within their reach, with the most time on the ball, and their
 * team has it; with no one there, it's cleared up the pitch as far as they
 * can head it, theirs to chase. A glancing one comes off them on about the
 * way it was going, not far, and is anyone's.
 */
function headClear(world: Match, eid: number) {
  if (!playBall(world, eid)) return
  const { ball, rng } = world
  const heading = Outfielder.heading[eid]
  world.pass = null
  Dribbler.cooldown[eid] = HEADER_RECOVER
  if (rng() < headerCleanChance(heading)) {
    const reach = headerReach(heading)
    const mate = headerTarget(world, eid, reach)
    const forward = attackDir(Team.id[eid]) > 0 ? 0 : Math.PI
    const angle = mate === -1 ? forward + gaussian(rng) * CLEAR_SPREAD : atan2(Position.y[mate] - Position.y[ball], Position.x[mate] - Position.x[ball])
    const distance = mate === -1 ? reach : hypot(Position.x[mate] - Position.x[ball], Position.y[mate] - Position.y[ball])
    // Looped up, to come down at their feet.
    const flight = loftFlightTime(distance) * HEADER_LOOP
    Velocity.x[ball] = (cos(angle) * distance) / flight
    Velocity.y[ball] = (sin(angle) * distance) / flight
    Velocity.z[ball] = (GRAVITY * flight) / 2 - (Position.z[ball] - BALL_RADIUS) / flight
    world.onDecision?.(eid, mate === -1 ? 'heads it clear' : `heads it on to ${playerLabel(world, mate)}`)
    winBall(world, eid, 'intercepted')
    return
  }
  const angle = atan2(Velocity.y[ball], Velocity.x[ball]) + gaussian(rng) * GLANCE_SPREAD
  const speed = GLANCE_SLOWEST + rng() * (GLANCE_FASTEST - GLANCE_SLOWEST)
  Velocity.x[ball] = cos(angle) * speed
  Velocity.y[ball] = sin(angle) * speed
  Velocity.z[ball] = rng() * GLANCE_LIFT
  world.lastTouch = null
  world.lastTouchedBy = eid
  world.lastTouchDeliberate = false
  world.onDecision?.(eid, 'gets a glancing head to it')
  cue(world, { kind: 'loose', player: eid })
}

/**
 * The teammate of `eid` to head it on to: up the pitch from them, within
 * `reach` (m), and with the most time before an opponent gets to them; -1
 * if there's no one.
 */
function headerTarget(world: Match, eid: number, reach: number): number {
  const ball = world.ball
  const dir = attackDir(Team.id[eid])
  let best = -1
  let most = -Infinity
  for (const mate of world.teams[Team.id[eid]].outfielders) {
    if (mate === eid) continue
    const dx = Position.x[mate] - Position.x[ball]
    const dy = Position.y[mate] - Position.y[ball]
    const d = hypot(dx, dy)
    if (d < HEADER_MIN || d > reach || (dx * dir) / d < HEADER_CONE) continue
    const time = timeOnBall(world, mate, eid)
    if (time > most) {
      best = mate
      most = time
    }
  }
  return best
}

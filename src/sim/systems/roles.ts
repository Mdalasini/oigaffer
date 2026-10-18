import { hasComponent } from 'bitecs'
import { Defender, DefenderMode, Offside, Position, Sliding, Velocity } from '../components'
import { engage, handOver, quickestTo, type Match } from '../match'
import { arrivalTime } from '../space/arrival'
import { opponent } from '../teams'
import { CONTROL_RADIUS, footDistance } from '../touch'

/** Seconds quicker to the ball another defender must be before taking over the press: "mine!". */
const PRESS_HANDOVER = 0.35
/** Seconds quicker to a loose ball a teammate must be before going for it instead of the carrier. */
const LOOSE_HANDOVER = 0.3
/** A new presser steadies themselves this long (s) before challenging. */
const ENGAGE_DELAY = 0.15
/** Judge a moving ball by where it will be this far ahead (s). */
const BALL_LOOKAHEAD = 0.3
const REACH = 0.9
/** A ball moving this fast (m/s) towards a player is coming to them. */
const COMING_SPEED = 1

/** Whether the ball is rolling towards `eid`. */
function comingTo(world: Match, eid: number) {
  const ball = world.ball
  const dx = Position.x[eid] - Position.x[ball]
  const dy = Position.y[eid] - Position.y[ball]
  const distance = Math.hypot(dx, dy) || 1
  return (Velocity.x[ball] * dx + Velocity.y[ball] * dy) / distance > COMING_SPEED
}

/**
 * Who does what around the ball, in open play. The defender clearly quickest
 * to the ball engages it, so the second defender steps in once the first is
 * beaten. A loose ball goes to whichever attacker gets there first. Each
 * change needs a clear margin, so the roles don't flicker between players
 * who are about level.
 */
export function rolesSystem(world: Match, _dt: number) {
  if (world.phase !== 'play') return
  const { ball, carrier, presser } = world
  const bx = Position.x[ball] + Velocity.x[ball] * BALL_LOOKAHEAD
  const by = Position.y[ball] + Velocity.y[ball] * BALL_LOOKAHEAD
  const time = (eid: number) => (hasComponent(world, eid, Sliding) ? Infinity : arrivalTime(world, eid, bx, by, REACH))

  // A tackle or slide already under way plays out before anyone else takes over.
  const mode = Defender.mode[presser]
  if (mode === DefenderMode.Jockey || mode === DefenderMode.Run || mode === DefenderMode.Grounded) {
    const candidate = quickestTo(world, opponent(world.possession), bx, by, presser)
    if (time(candidate) < time(presser) - PRESS_HANDOVER) engage(world, candidate, ENGAGE_DELAY)
  }

  // A pass on its way belongs to its receiver, and so does a ball rolling to the carrier, such as
  // the keeper's roll-out; only a ball that's got away is anyone's.
  if (!world.pass && footDistance(carrier, ball) > CONTROL_RADIUS && !comingTo(world, carrier)) {
    const mate = quickestTo(world, world.possession, bx, by, carrier)
    // A teammate who'd be offside leaves it.
    if (!Offside.flagged[mate] && time(mate) < time(carrier) - LOOSE_HANDOVER) handOver(world, mate)
  }
}

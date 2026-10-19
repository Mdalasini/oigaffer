import { clearIntentions, moveOn } from './attacking'
import { Goalkeeper, Mark, OffBall, Outfielder, Position, Run } from './components'
import { runTimingError } from './grades'
import type { Match } from './match'
import { inSight, maybeScanBeforeReceiving } from './perception'
import type { PassOption } from './playmaking'
import { gaussian } from './rng'
import { maybeSpringTrap } from './systems/defending'
import { opponent } from './teams'

/**
 * The moments in a match that players react to. Each is announced once,
 * where it happens, with `cue`; how everyone responds lives here, so what
 * players notice, and how quickly they act on it, is in one place.
 *
 * A cue doesn't move anyone itself. It brings forward a player's next look
 * at the situation, or a team's next sharing out of jobs, by however long
 * they take to react; the systems then decide as usual.
 */
export type Cue =
  /** The ball has changed hands between the teams, or a restart has given it to `team`. */
  | { kind: 'possession'; team: number }
  /** `player` is now on the ball, taking over from `previous` (-1 if nobody). */
  | { kind: 'carrier'; player: number; previous: number }
  /** `player` now engages the ball for their team, taking over from `previous` (-1 if nobody). */
  | { kind: 'presser'; player: number; previous: number }
  /** A keeper has the ball in their hands. */
  | { kind: 'held'; keeper: number }
  /** A pass is on its way from `passer` to `receiver`. */
  | { kind: 'passStruck'; passer: number; receiver: number }
  /** `runner` has gone for the space in behind. */
  | { kind: 'run'; runner: number }
  /** The carrier is shaping to play `option`, striking it `windup` seconds from now. */
  | { kind: 'passShaped'; passer: number; option: PassOption; windup: number }
  /** The pass being shaped won't be played after all. */
  | { kind: 'passCalledOff'; option: PassOption }
  /** `team`'s line is stepping up together to catch a runner offside. */
  | { kind: 'trap'; team: number }
  /** A ball in the air has come loose: `player` didn't bring it down, or headed it away. */
  | { kind: 'loose'; player: number }

/** Players take this long, plus up to as long again, to react to the ball changing hands. */
const TURNOVER_REACTION = 0.2
/** Players take this long, plus up to as long again, to react to a pass being struck. */
const BALL_MOVED_REACTION = 0.2
/** A marker who sees their man set off takes this long, plus up to as long again, to go with him. */
const RUN_REACTION = 0.1
/** Seconds before defenders react to the trap being sprung. */
const TRAP_REACTION = 0.08

/** Announces `c`, and everyone it concerns responds. */
export function cue(world: Match, c: Cue) {
  world.onCue?.(c)
  switch (c.kind) {
    case 'possession':
      reshareJobs(world)
      // Everyone takes a moment to register the change before they reshape.
      for (const t of [0, 1]) {
        for (const eid of world.teams[t].outfielders) OffBall.decideIn[eid] = TURNOVER_REACTION + world.rng() * TURNOVER_REACTION
      }
      return
    case 'carrier':
    case 'presser':
      // Who's free to be marked has changed.
      reshareJobs(world)
      if (c.previous !== -1) stepOffBall(world, c.previous)
      return
    case 'held':
      reshareJobs(world)
      // They look for who to roll it to straight away.
      Goalkeeper.nextLook[c.keeper] = 0
      return
    case 'passStruck':
      // Everyone watches the ball go, and rethinks where they should be once they've seen where it's going: a look
      // that was due any moment waits for that too, or it would be taken with the ball still at the passer's feet.
      for (const t of [0, 1]) {
        for (const eid of world.teams[t].outfielders) OffBall.decideIn[eid] = BALL_MOVED_REACTION + world.rng() * BALL_MOVED_REACTION
      }
      maybeScanBeforeReceiving(world, c.receiver)
      moveOn(world, c.passer)
      return
    case 'run':
      seeRunGo(world, c.runner)
      return
    case 'passShaped':
      passShaped(world, c.option, c.windup)
      return
    case 'passCalledOff':
      // A runner waiting to burst for it stays put.
      Run.burstAt[c.option.receiver] = 0
      return
    case 'loose':
      // Everyone sees where it's gone, and reacts as they would to a pass.
      for (const t of [0, 1]) {
        for (const eid of world.teams[t].outfielders) OffBall.decideIn[eid] = Math.min(OffBall.decideIn[eid], BALL_MOVED_REACTION + world.rng() * BALL_MOVED_REACTION)
      }
      return
    case 'trap':
      for (const d of world.teams[c.team].outfielders) {
        if (d !== world.presser) OffBall.decideIn[d] = Math.min(OffBall.decideIn[d], TRAP_REACTION)
      }
      return
  }
}

/** Both teams share out their defensive jobs again at once, rather than at the next regular moment. */
function reshareJobs(world: Match) {
  world.nextMarking = [0, 0]
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

/**
 * A run starting: a marker watching their man sees him go and goes with him.
 * One who has lost sight of him, as when he's gone off behind their back,
 * finds out only when they next look (see `perception`), and is left
 * marking where he was.
 */
function seeRunGo(world: Match, runner: number) {
  for (const marker of world.teams[opponent(world.possession)].outfielders) {
    if (Mark.target[marker] !== runner || !inSight(world, marker, runner)) continue
    OffBall.decideIn[marker] = Math.min(OffBall.decideIn[marker], RUN_REACTION + world.rng() * RUN_REACTION)
  }
}

/**
 * The carrier shaping to pass. With an attacker lurking on the line, the
 * defence may spring the trap. A runner reads a through ball being shaped
 * for them and times their burst to the strike: go early and they're offside.
 */
function passShaped(world: Match, option: PassOption, windup: number) {
  maybeSpringTrap(world, windup)
  const runner = option.receiver
  Run.burstAt[runner] = 0
  if (option.kind !== 'through') return
  const delay = Math.max(0, windup + gaussian(world.rng) * runTimingError(Outfielder.offTheBall[runner]))
  Run.burstAt[runner] = world.time + delay
  OffBall.decideIn[runner] = delay
}

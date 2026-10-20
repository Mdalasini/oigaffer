import { angleDelta } from './angles'
import { Call, CallKind, Effort, OffBall, Outfielder, Position, Run, RunPhase } from './components'
import { cue } from './cues'
import { gradeT } from './grades'
import type { Match } from './match'
import { inOffsidePosition } from './offside'
import { seenFacing, seenX, seenY } from './perception'
import { rateFeetPass } from './playmaking'
import { gaussian } from './rng'
import { along, homePosition, onsideLimit } from './shape'
import { arrivalTime } from './space/arrival'
import { teamArrival, timeOnBall } from './space/control'
import { threat } from './space/threat'
import { attackDir, opponent } from './teams'
import { atan2, cos, exp, hypot, sin } from './fmath'

/** Where an attacker without the ball is heading, and how hard. */
export interface Intent {
  x: number
  y: number
  effort: Effort
  /** Why, when someone is reading the match back (`onDecision`). */
  why?: string
}

/** Attackers keep at least this far (m) from the carrier, so they offer a pass rather than crowd them. */
const SPACING = 9.6

// Showing for it: when the carrier has less than PRESSURED seconds on the
// ball, or is facing their own goal, a teammate goes to the spot around them
// where a pass would be worth most, among these distances (m) and directions.
const PRESSURED = 0.8
const FACING_BACK = 1.9
/** Once showing, they keep at it until the carrier has this long (s) on the ball, so they don't flit in and out. */
const RELIEVED = 1.3
const SHOW_DISTANCES = [8, 11, 14]
const SHOW_DIRECTIONS = 12
/**
 * Having picked a spot to show in, they make for it for this long (s)
 * before weighing the spots up again, as long as it stays onside and on the
 * pitch: a movement is committed to, not re-judged from scratch every look.
 */
const SHOW_COMMIT = 1
/** Another spot must beat the current one by this share of its value, and at least KEEP_SPOT_MIN, to be worth moving to. */
const KEEP_SPOT = 0.2
const KEEP_SPOT_MIN = 0.01
/** Value lost for every second it takes to get to a spot, so nearer spots win ties. */
const TRAVEL_COST = 0.01
/**
 * At most this many show for it at once: two give the carrier a triangle,
 * while the rest keep the width and depth that stretch the defence.
 */
const MAX_SHOWING = 2
/** A teammate already showing keeps the job unless another is this much (s) nearer the ball. */
const KEEP_SHOWING = 0.5
/**
 * A spot within this angle (rad) of another teammate, seen from the ball,
 * offers the carrier the same pass, and is worth this much less.
 */
const SAME_ANGLE = 0.5
const SAME_ANGLE_COST = 0.03
/** With at least this many outfielders, one stays behind the ball to stop the counter. */
const REST_DEFENCE_FROM = 3
/**
 * The rest defence holds at least this far (m) behind the ball once it's at
 * halfway or beyond. Building it up from deeper, there's less room in behind
 * to cover, so they come up level with it within REST_LEVEL_SHARE of the
 * half's length from their own goal line, and offer the pass across rather
 * than back.
 */
const REST_BEHIND = 6
const REST_LEVEL_SHARE = 0.4
/** One runner in behind at a time for every this many outfielders. */
const PLAYERS_PER_RUNNER = 4
/** A teammate calls for it to feet when they reckon a pass to them would get through at least this often. */
const CALL_WHEN_SAFE = 0.85

// Opening a lane: a teammate holding a place at least LANE_AHEAD metres
// ahead of the ball looks for a spot LANE_SHIFTS metres off that place, in
// LANE_DIRECTIONS directions across and forward, where a pass to them from
// the ball would be worth most: out of a blocked lane, away from their
// marker, into a gap in the line in front of them.
const LANE_AHEAD = 2
const LANE_SHIFTS = [6]
/** Only this many of those, the nearest the ball, look for one: the rest are too far off to be the next pass. */
const LANE_SEEKERS = 3
const LANE_DIRECTIONS = 5
/** Value lost for every metre a spot is from their place, so they keep the shape unless a lane is worth it. */
const DRIFT_COST = 0.0002
/**
 * The lane they're in keeps them unless another is better by this share of
 * its value, and at least KEEP_LANE_MIN; more, by DOUBT times their
 * misjudgement, for a player who reads lanes less surely, so a fresh misread
 * doesn't change their mind.
 */
const KEEP_LANE = 0.15
const KEEP_LANE_MIN = 0.001
const DOUBT = 2
/** Their misjudgement of a lane is at least this big a share, so lanes worth next to nothing still vary. */
const LANE_MIN_JUDGED = 0.005

// Running in behind: the cue is a carrier with at least CARRIER_TIME seconds
// on the ball, facing within CARRIER_FACING (rad) of goal, a runner within
// NEAR_LINE metres of the opposition's line, and at least SPACE_BEHIND
// metres between that line and the goal line.
const CARRIER_TIME = 0.7
const CARRIER_FACING = 1.1
const NEAR_LINE = 10
const SPACE_BEHIND = 6
/** How far (m) beyond the line to aim a run, and how far across from where the runner is. */
const RUN_DEPTHS = [5, 8, 11]
const RUN_ACROSS = [0, -5, 5]
/** A run is only worth making if the runner is at least this likely to get there first. */
const MIN_RACE = 0.35
const RACE_SCALE = 0.3
/** Seconds checking away before going, from the worst runner to the best. */
const PREPARE_SLOW = 0.6
const PREPARE_QUICK = 0.3
/** How far (m) they check towards the ball first. */
const CHECK_AWAY = 2
/** Seconds the run stays on without a pass before they give it up. */
const GO_WINDOW = 1.8
/** Moving on after a pass: to a spot this far (m) further forward, and this far across, from where they played it. */
const MOVE_ON_AHEAD = [6, 10]
const MOVE_ON_ACROSS = [-6, 0, 6]
/** Only worth moving on to a spot worth at least this share of the threat where they are, once how open it is counts. */
const MOVE_ON_WORTH = 0.8
/** Seconds before making another run, plus up to as long again. */
const RUN_REST = 2.5

/**
 * What an attacker without the ball does, decided a few times a second:
 *
 * - **Run in behind** when the carrier can play forward: check towards the
 *   ball, then sprint for the space beyond the line, staying onside until the
 *   pass and calling for it in behind. A run that isn't found within a couple
 *   of seconds is given up, and they rejoin the shape. Only one runs at a
 *   time in a small side, so the others stay to support.
 * - **Show for it** when the carrier is under pressure or facing their own
 *   goal: go to the spot where a pass to them would be worth most, and call
 *   for it to feet. The one or two nearest the ball do this, each offering a
 *   different angle from the other; the rest keep the shape.
 * - Otherwise **hold** their place in the shape, kept clear of the carrier,
 *   shifting off it to open a lane ahead of the ball, and calling for it
 *   when they're free.
 *
 * In a side of three or more, whoever plays deepest in the shape stays back
 * as **rest defence**: they hold, behind the ball, ready for the counter and
 * as the outlet to play back to, and never run or show ahead of it.
 */
export function attackingIntent(world: Match, eid: number): Intent {
  const carrier = world.carrier
  // Showing for it when a pass is played elsewhere, they keep going where they were, the next pass may well come
  // there, unless that's on top of the passer: then they'd only crowd him, and take up the shape instead. If the
  // pass has made them the rest defence, that comes first.
  const pass = world.pass
  if (world.phase === 'play' && pass && pass.to !== eid && OffBall.showing[eid] && Run.phase[eid] === RunPhase.None && restDefender(world) !== eid) {
    if (hypot(Call.x[eid] - Position.x[pass.from], Call.y[eid] - Position.y[pass.from]) >= SPACING) {
      return because(world, { x: Call.x[eid], y: Call.y[eid], effort: Effort.Run }, 'keeps showing while the pass is on')
    }
  }
  // While the keeper has it, or a pass is on its way to someone else, they keep the shape; a run already going goes on.
  // The lane they hold they keep through a pass, or each look would pick one afresh and they'd go back and forth.
  if (world.phase !== 'play' || carrier === eid || (world.pass && Run.phase[eid] !== RunPhase.Go)) {
    endRun(world, eid, true)
    return because(world, hold(world, eid, false), world.phase !== 'play' ? 'holds the shape: the keeper has it' : 'holds the shape: a pass is on to someone else')
  }

  // The rest defence gives up any run they were on: someone has to stay back.
  const rest = restDefender(world) === eid
  if (rest) {
    endRun(world, eid)
    return because(world, hold(world, eid, true), 'holds back as rest defence')
  }

  if (Run.phase[eid] === RunPhase.Prepare) {
    if (Run.timer[eid] > 0) return because(world, checkAway(world, eid), 'checks away before the run in behind')
    Run.phase[eid] = RunPhase.Go
    Run.timer[eid] = GO_WINDOW
    cue(world, { kind: 'run', runner: eid })
  }
  if (Run.phase[eid] === RunPhase.Go) {
    if (Run.timer[eid] > 0 && !inOffsidePosition(world, eid)) {
      Call.kind[eid] = CallKind.Space
      Call.x[eid] = Run.targetX[eid]
      Call.y[eid] = Run.targetY[eid]
      return because(world, { x: Run.targetX[eid], y: Run.targetY[eid], effort: Effort.Sprint }, 'runs in behind, calling for it in space')
    }
    if (world.onDecision) world.onDecision(eid, Run.timer[eid] > 0 ? 'gives up the run: offside' : 'gives up the run: not found in time')
    endRun(world, eid)
  }

  // A throw-in has to be thrown to someone: the nearest come to get it.
  if (world.thrower !== -1 && amongShowing(world, eid)) {
    return because(world, showForIt(world, eid), 'shows for the throw-in: they are among the nearest')
  }
  if (pressured(world, eid, OffBall.showing[eid] ? RELIEVED : PRESSURED) && amongShowing(world, eid)) {
    return because(world, showForIt(world, eid), 'shows for it: the carrier is under pressure and they are among the nearest')
  }
  OffBall.showing[eid] = 0
  if (runnerFree(world, eid) && runCue(world, eid) && world.rng() < runChance(eid)) {
    const target = runTarget(world, eid)
    if (target) {
      Run.phase[eid] = RunPhase.Prepare
      Run.timer[eid] = PREPARE_SLOW + (PREPARE_QUICK - PREPARE_SLOW) * gradeT(Outfielder.offTheBall[eid])
      Run.targetX[eid] = target.x
      Run.targetY[eid] = target.y
      return because(world, checkAway(world, eid), `sets off on a run in behind to (${target.x.toFixed(1)}, ${target.y.toFixed(1)}): checks away first`)
    }
  }
  return because(world, hold(world, eid, true), 'holds their place in the shape')
}

/** Notes why on `intent`, ahead of anything it already says, if someone is reading the match back. */
function because(world: Match, intent: Intent, why: string): Intent {
  if (world.onDecision) intent.why = intent.why ? `${why} (${intent.why})` : why
  return intent
}

/**
 * Having passed it, `passer` moves on into space ahead rather than standing
 * where they played it: the open, onside spot a few metres on worth most,
 * calling for it there, so the receiver can give it straight back into
 * their path. The rest defence stays back, and so does anyone with nowhere
 * open to go, or whose team has as many running as it can spare.
 */
export function moveOn(world: Match, passer: number) {
  const team = world.possession
  if (world.phase !== 'play' || passer === world.teams[team].keeper || restDefender(world) === passer || Run.rest[passer] > 0) return
  // It's a run of its own: not while the team already has as many going as it can spare.
  if (!runnerFree(world, passer)) return
  const { halfLength: L, halfWidth: W } = world.pitch
  const limit = onsideLimit(world, team, passer) - 1
  const dir = attackDir(team)
  let best: { x: number; y: number } | null = null
  let bestScore = 0
  for (const ahead of MOVE_ON_AHEAD) {
    for (const across of MOVE_ON_ACROSS) {
      const u = Math.min(along(team, Position.x[passer]) + ahead, limit, L - 3)
      const x = u * dir
      const y = clamp(Position.y[passer] + across, -(W - 3), W - 3)
      const open = 1 / (1 + exp(-(teamArrival(world, opponent(team), x, y, 0.5, passer) - arrivalTime(world, passer, x, y, 0.5)) / RACE_SCALE))
      const score = threat(world.pitch, team, x, y) * open
      if (score > bestScore) {
        best = { x, y }
        bestScore = score
      }
    }
  }
  if (!best || bestScore < MOVE_ON_WORTH * threat(world.pitch, team, Position.x[passer], Position.y[passer])) return
  Run.phase[passer] = RunPhase.Go
  Run.timer[passer] = GO_WINDOW
  Run.targetX[passer] = best.x
  Run.targetY[passer] = best.y
}

/** Counts down the run's clock and the rest before the next one. Called every tick. */
export function tickRun(eid: number, dt: number) {
  Run.timer[eid] -= dt
  Run.rest[eid] = Math.max(0, Run.rest[eid] - dt)
}

/** Gives up the run, if there was one, and stops calling; with `keepLane`, the lane they hold stays theirs. */
export function endRun(world: Match, eid: number, keepLane = false) {
  if (Run.phase[eid] !== RunPhase.None) Run.rest[eid] = RUN_REST * (1 + world.rng())
  const laneX = OffBall.laneX[eid]
  const laneY = OffBall.laneY[eid]
  clearIntentions(eid)
  if (keepLane) {
    OffBall.laneX[eid] = laneX
    OffBall.laneY[eid] = laneY
  }
}

/** Forgets any run, call or showing: on the ball, leaving a role, or at a restart. */
export function clearIntentions(eid: number) {
  Run.phase[eid] = RunPhase.None
  Run.timer[eid] = 0
  Call.kind[eid] = CallKind.None
  OffBall.showing[eid] = 0
  OffBall.laneX[eid] = 0
  OffBall.laneY[eid] = 0
}

/**
 * Their place in the shape, kept clear of the carrier, calling for it if
 * they're free. Ahead of the ball, they shift off it to open a lane for a
 * pass (see `openLane`). The rest defence holds it behind the ball, however
 * far forward their place would be.
 */
function hold(world: Match, eid: number, mayCall: boolean): Intent {
  // What moved them off their spot, only gathered for someone reading the match back.
  const notes: string[] | null = world.onDecision ? [] : null
  let { x, y } = homePosition(world, eid)
  const carrier = world.carrier
  const L = world.pitch.halfLength
  if (world.phase === 'play' && restDefender(world) === eid) {
    const team = world.possession
    const ball = along(team, Position.x[world.ball])
    const level = REST_LEVEL_SHARE * L
    const behind = REST_BEHIND * clamp((ball + L - level) / (L - level), 0, 1)
    x = Math.min(along(team, x), ball - behind, L - 1) * attackDir(team)
    x = clamp(x, -(L - 1), L - 1)
  } else if (world.phase !== 'held' && carrier !== eid) {
    if (world.phase === 'play') {
      const home = { x, y }
      ;({ x, y } = openLane(world, eid, x, y))
      if (x !== home.x || y !== home.y) notes?.push('shifted off their spot to open a lane')
    }
    const dx = x - Position.x[carrier]
    const dy = y - Position.y[carrier]
    const gap = hypot(dx, dy)
    if (gap < SPACING) {
      notes?.push(`kept ${SPACING} m off the carrier`)
      // Slide away from the carrier, keeping on the side they're already on.
      const ux = gap > 0.5 ? dx / gap : 0
      const uy = gap > 0.5 ? dy / gap : Math.sign(y - Position.y[carrier]) || 1
      x = Position.x[carrier] + ux * SPACING
      y = Position.y[carrier] + uy * SPACING
    }
  }
  Call.kind[eid] = CallKind.None
  if (mayCall && rateFeetPass(world, world.possession, eid, Position.x[eid], Position.y[eid], eid, Position.x[world.ball], Position.y[world.ball], true).safety >= CALL_WHEN_SAFE) {
    Call.kind[eid] = CallKind.Feet
    Call.x[eid] = Position.x[eid]
    Call.y[eid] = Position.y[eid]
    notes?.push('free, so calling for it to feet')
  }
  const distance = hypot(x - Position.x[eid], y - Position.y[eid])
  return { x, y, effort: distance > 10 ? Effort.Run : distance > 3 ? Effort.Jog : Effort.Walk, why: notes?.join('; ') || undefined }
}

/**
 * The carrier's teammate who stays back as rest defence: whoever's place in
 * the shape is deepest. When that player has the ball, the next deepest
 * takes over. -1 in a side too small to spare one.
 */
export function restDefender(world: Match): number {
  const team = world.possession
  const squad = world.teams[team].outfielders
  if (squad.length < REST_DEFENCE_FROM) return -1
  let deepest = -1
  let depth = Infinity
  for (const eid of squad) {
    if (eid === world.carrier) continue
    const u = along(team, homePosition(world, eid).x)
    if (u < depth) {
      deepest = eid
      depth = u
    }
  }
  return deepest
}

/**
 * Whether `eid` is one of the teammates who should show for it: the ones
 * nearest the ball, not running and not the rest defence. Those already
 * showing keep at it unless someone else is clearly nearer.
 */
function amongShowing(world: Match, eid: number): boolean {
  const rest = restDefender(world)
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  const time = (m: number) => arrivalTime(world, m, bx, by) - (OffBall.showing[m] ? KEEP_SHOWING : 0)
  const own = time(eid)
  let nearer = 0
  for (const mate of world.teams[world.possession].outfielders) {
    if (mate === eid || mate === world.carrier || mate === rest || Run.phase[mate] !== RunPhase.None) continue
    if (time(mate) < own) nearer++
  }
  return nearer < MAX_SHOWING
}

/** Whether there's room for `eid` to run in behind: not too many teammates running already. */
function runnerFree(world: Match, eid: number): boolean {
  const squad = world.teams[world.possession].outfielders
  const limit = Math.max(1, Math.floor(squad.length / PLAYERS_PER_RUNNER))
  return squad.filter((mate) => mate !== eid && Run.phase[mate] !== RunPhase.None).length < limit
}

/**
 * Whether the carrier needs a way out, as `eid` sees it: less than `time`
 * seconds before they're closed down, or facing their own goal.
 */
function pressured(world: Match, eid: number, time: number): boolean {
  const carrier = world.carrier
  const forward = attackDir(world.possession) > 0 ? 0 : Math.PI
  return timeOnBall(world, carrier, eid) < time || Math.abs(angleDelta(seenFacing(world, eid, carrier), forward)) > FACING_BACK
}

/**
 * Goes to the spot around the carrier where a pass to them would be worth
 * most: not in a defender's way, onside, and as dangerous as it can be. A
 * worse player judges the spots less accurately.
 */
function showForIt(world: Match, eid: number): Intent {
  const team = world.possession
  const bx = Position.x[world.ball]
  const by = Position.y[world.ball]
  const limit = onsideLimit(world, team) - 1
  const error = 0.4 * (1 - gradeT(Outfielder.offTheBall[eid]))
  // Where the carrier's other options are, as angles from the ball: where teammates are showing, or standing.
  const others: number[] = []
  for (const mate of world.teams[team].outfielders) {
    if (mate === eid || mate === world.carrier) continue
    const showing = OffBall.showing[mate]
    others.push(atan2((showing ? Call.y[mate] : Position.y[mate]) - by, (showing ? Call.x[mate] : Position.x[mate]) - bx))
  }
  const score = (x: number, y: number) => {
    const { value } = rateFeetPass(world, team, eid, x, y, eid)
    const angle = atan2(y - by, x - bx)
    const overlap = others.reduce((sum, other) => sum + Math.max(0, 1 - Math.abs(angleDelta(angle, other)) / SAME_ANGLE), 0)
    return value + gaussian(world.rng) * error * Math.max(Math.abs(value), 0.02) - TRAVEL_COST * arrivalTime(world, eid, x, y) - SAME_ANGLE_COST * overlap
  }
  const onPitch = (x: number, y: number) => Math.abs(x) <= world.pitch.halfLength - 1.5 && Math.abs(y) <= world.pitch.halfWidth - 1.5
  const keepable = OffBall.showing[eid] === 1 && along(team, Call.x[eid]) <= limit && onPitch(Call.x[eid], Call.y[eid])
  if (keepable && world.time - OffBall.showSince[eid] < SHOW_COMMIT) return { x: Call.x[eid], y: Call.y[eid], effort: Effort.Run }
  // The spot they're already showing in keeps them unless another is clearly better.
  let best = { x: Position.x[eid], y: Position.y[eid] }
  let bestScore = -Infinity
  if (keepable) {
    best = { x: Call.x[eid], y: Call.y[eid] }
    const current = score(best.x, best.y)
    bestScore = current + Math.abs(current) * KEEP_SPOT + KEEP_SPOT_MIN
  }
  for (const distance of SHOW_DISTANCES) {
    for (let i = 0; i < SHOW_DIRECTIONS; i++) {
      const angle = (i / SHOW_DIRECTIONS) * Math.PI * 2
      const x = bx + cos(angle) * distance
      const y = by + sin(angle) * distance
      if (!onPitch(x, y) || along(team, x) > limit) continue
      const s = score(x, y)
      if (s > bestScore) {
        best = { x, y }
        bestScore = s
      }
    }
  }
  if (!OffBall.showing[eid] || best.x !== Call.x[eid] || best.y !== Call.y[eid]) OffBall.showSince[eid] = world.time
  OffBall.showing[eid] = 1
  Call.kind[eid] = CallKind.Feet
  Call.x[eid] = best.x
  Call.y[eid] = best.y
  return { ...best, effort: Effort.Run }
}

/**
 * Whether `eid` is among the LANE_SEEKERS teammates nearest (ox, oy) who are
 * ahead of it, leaving out the carrier, the rest defence and anyone showing
 * or running; with teammates where `eid` reckons they are.
 */
function amongNextOptions(world: Match, eid: number, ox: number, oy: number): boolean {
  const team = world.possession
  const rest = restDefender(world)
  const own = hypot(Position.x[eid] - ox, Position.y[eid] - oy)
  let nearer = 0
  for (const mate of world.teams[team].outfielders) {
    if (mate === eid || mate === world.carrier || mate === rest || OffBall.showing[mate] || Run.phase[mate] !== RunPhase.None) continue
    const mx = seenX(world, eid, mate)
    const my = seenY(world, eid, mate)
    if (along(team, mx) < along(team, ox) + LANE_AHEAD) continue
    if (hypot(mx - ox, my - oy) < own && ++nearer >= LANE_SEEKERS) return false
  }
  return true
}

/**
 * Where near their place (hx, hy) a teammate ahead of the ball would be
 * worth most to pass to, as they see it: from the ball, or from where a
 * pass on its way will be received, so they're open for the next one. The
 * lane they've already found keeps them unless another is clearly better,
 * and a worse player judges the spots less accurately.
 */
function openLane(world: Match, eid: number, hx: number, hy: number) {
  const team = world.possession
  // The next pass is played from where the one on its way will be received.
  const ox = world.pass ? world.pass.x : Position.x[world.ball]
  const oy = world.pass ? world.pass.y : Position.y[world.ball]
  if (along(team, hx) < along(team, ox) + LANE_AHEAD || !amongNextOptions(world, eid, ox, oy)) {
    OffBall.laneX[eid] = OffBall.laneY[eid] = 0
    return { x: hx, y: hy }
  }
  const { halfLength: L, halfWidth: W } = world.pitch
  const limit = onsideLimit(world, team, eid) - 1
  const error = 0.4 * (1 - gradeT(Outfielder.offTheBall[eid]))
  const score = (dx: number, dy: number) => {
    const { value } = rateFeetPass(world, team, eid, hx + dx, hy + dy, eid, ox, oy)
    return value + gaussian(world.rng) * error * Math.max(Math.abs(value), LANE_MIN_JUDGED) - DRIFT_COST * hypot(dx, dy)
  }
  const fits = (dx: number, dy: number) => Math.abs(hx + dx) <= L - 1.5 && Math.abs(hy + dy) <= W - 1.5 && along(team, hx + dx) <= limit
  // The lane they're already in, one of the spots below, keeps them unless another is clearly better.
  const kept = (dx: number, dy: number, s: number) =>
    Math.abs(dx - OffBall.laneX[eid]) < 0.01 && Math.abs(dy - OffBall.laneY[eid]) < 0.01 ? s + Math.abs(s) * (KEEP_LANE + DOUBT * error) + KEEP_LANE_MIN : s
  let best = { dx: 0, dy: 0 }
  let bestScore = fits(0, 0) ? kept(0, 0, score(0, 0)) : -Infinity
  for (const shift of LANE_SHIFTS) {
    for (let i = 0; i < LANE_DIRECTIONS; i++) {
      // Across or forward, never back towards the ball: dropping in only brings their marker with them.
      const angle = (i / (LANE_DIRECTIONS - 1) - 0.5) * Math.PI
      const dx = cos(angle) * shift * attackDir(team)
      const dy = sin(angle) * shift
      if (!fits(dx, dy)) continue
      const s = kept(dx, dy, score(dx, dy))
      if (s > bestScore) {
        best = { dx, dy }
        bestScore = s
      }
    }
  }
  OffBall.laneX[eid] = best.dx
  OffBall.laneY[eid] = best.dy
  return { x: hx + best.dx, y: hy + best.dy }
}

/** Whether now is the moment to run in behind. */
function runCue(world: Match, eid: number): boolean {
  const team = world.possession
  const carrier = world.carrier
  if (Run.rest[eid] > 0 || inOffsidePosition(world, eid)) return false
  const limit = onsideLimit(world, team)
  if (world.pitch.halfLength - limit < SPACE_BEHIND || limit - along(team, Position.x[eid]) > NEAR_LINE) return false
  const forward = attackDir(team) > 0 ? 0 : Math.PI
  // As they see it: a carrier they reckon has time and is facing forward.
  return timeOnBall(world, carrier, eid) >= CARRIER_TIME && Math.abs(angleDelta(seenFacing(world, eid, carrier), forward)) <= CARRIER_FACING
}

/** Chance, each time the cue is there, that they go: better movers spot the moment more often. */
function runChance(eid: number): number {
  return 0.15 + 0.45 * gradeT(Outfielder.offTheBall[eid])
}

/**
 * The best space behind the line to run into: as dangerous as possible,
 * among spots they'd get to before any defender or the keeper. Null if
 * there's none they'd win.
 */
function runTarget(world: Match, eid: number) {
  const team = world.possession
  const limit = onsideLimit(world, team)
  const { halfLength: L, halfWidth: W } = world.pitch
  let best: { x: number; y: number } | null = null
  let bestScore = 0
  for (const depth of RUN_DEPTHS) {
    const u = Math.min(limit + depth, L - 3)
    for (const across of RUN_ACROSS) {
      const x = u * attackDir(team)
      const y = clamp(Position.y[eid] + across, -(W - 3), W - 3)
      const race = 1 / (1 + exp(-(teamArrival(world, opponent(team), x, y, 0.5, eid) - arrivalTime(world, eid, x, y, 0.5)) / RACE_SCALE))
      if (race < MIN_RACE) continue
      const score = threat(world.pitch, team, x, y) * race
      if (score > bestScore) {
        best = { x, y }
        bestScore = score
      }
    }
  }
  return best
}

/** Before going, a couple of steps towards the ball to pull the marker, then spin away. */
function checkAway(world: Match, eid: number): Intent {
  const dx = Position.x[world.ball] - Position.x[eid]
  const dy = Position.y[world.ball] - Position.y[eid]
  const length = hypot(dx, dy) || 1
  return { x: Position.x[eid] + (dx / length) * CHECK_AWAY, y: Position.y[eid] + (dy / length) * CHECK_AWAY, effort: Effort.Jog }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

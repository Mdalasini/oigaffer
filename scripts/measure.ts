// Plays headless matches and reports how they played and what they cost.
//
//   bun scripts/measure.ts [minutes=30] [outfielders=4] [seeds=1,2,3]
//
// Per seed: the scoreline and tallies; how hard players off the ball work,
// how often teammates bunch, how often defenders are goal-side and attackers
// onside; each team's shape; how passes, take-ons, big touches and challenges
// go; and how long each system took per simulated minute, so a change can be
// judged on gameplay and performance together. Counts marked /90 are per team
// per 90 minutes, except oddities (see `bun run detect`), which are for both
// teams together.
import { Position, TakeOn, TouchStyle, Velocity } from '../src/sim/components'
import type { ChallengeKind } from '../src/sim/challenge'
import { createMatch, MATCH_SYSTEMS, type Match } from '../src/sim/match'
import { FIXED_DT } from '../src/sim/constants'
import { pitchFor } from '../src/sim/pitch'
import { along, onsideLimit } from '../src/sim/shape'
import { ownGoalX } from '../src/sim/teams'
import { LOOK_EVERY, watchFor } from '../src/sim/detectors'
import { ticksAt } from '../src/sim/replay'

/** A carrier working a defender counts as a take-on once the defender is this close (m) to the ball. */
const TAKE_ON_COUNTED = 3

const minutes = Number(process.argv[2] ?? 30)
const outfielders = Number(process.argv[3] ?? 4)
const seeds = (process.argv[4] ?? '1,2,3').split(',').map(Number)

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(0)}%`
const totals = new Map<string, number>()

const pitch = pitchFor(outfielders)
console.log(`${outfielders} outfielders a side on ${2 * pitch.halfLength} m x ${2 * pitch.halfWidth} m`)

for (const seed of seeds) {
  const world = createMatch({ seed, outfielders })
  const spent = new Map<string, number>()
  const tally = {
    samples: 0, walk: 0, jog: 0, run: 0, sprint: 0, reversals: 0,
    pairs: 0, bunched: 0, defenders: 0, goalSide: 0, attackers: 0, onside: 0,
    shapes: 0, attackDepth: 0, attackWidth: 0, defendDepth: 0, defendWidth: 0,
  }
  // Each player's heading at the last sample, to count sharp changes of direction.
  const heading = new Map<number, number>()
  const play = watchPlay(world)
  const oddities = watchFor(world)
  const start = performance.now()
  for (let tick = 0; world.time < minutes * 60; tick++) {
    step(world, spent)
    play.afterStep()
    if ((tick + 1) % ticksAt(LOOK_EVERY) === 0) oddities.look()
    if (tick % 12 || world.phase !== 'play') continue
    sample(world, tally, heading)
  }
  const ms = performance.now() - start
  oddities.finish()
  const s = world.stats
  console.log(`seed ${seed}: goals ${s[0].goals}-${s[1].goals} shots ${s[0].shots}/${s[1].shots} saved ${s[0].saved}/${s[1].saved} passes ${s[0].passes}/${s[1].passes} done ${pct(s[0].completed, s[0].passes)}/${pct(s[1].completed, s[1].passes)} offsides ${s[0].offsides + s[1].offsides} won ${s[0].won}/${s[1].won}`)
  const t = tally
  console.log(`  off the ball: walk ${pct(t.walk, t.samples)} jog ${pct(t.jog, t.samples)} run ${pct(t.run, t.samples)} sprint ${pct(t.sprint, t.samples)} | reversals ${(t.reversals / (t.samples / 10)).toFixed(2)}/player-s | bunched ${pct(t.bunched, t.pairs)} goal-side ${pct(t.goalSide, t.defenders)} onside ${pct(t.onside, t.attackers)}`)
  console.log(`  shape: attack ${(t.attackDepth / t.shapes).toFixed(1)} m deep x ${(t.attackWidth / t.shapes).toFixed(1)} m wide | defence ${(t.defendDepth / t.shapes).toFixed(1)} x ${(t.defendWidth / t.shapes).toFixed(1)}`)
  const p = play.tally
  const per90 = (n: number) => ((n * 90) / minutes / 2).toFixed(0)
  console.log(`  passes: ${(p.passLength / Math.max(1, p.passes)).toFixed(1)} m avg, over 30 m ${pct(p.long, p.passes)}, forward 10 m+ ${pct(p.progressive, p.passes)}, backward ${pct(p.backward, p.passes)}, straight back to the passer ${pct(p.returned, p.passes)} | of passes received, played on first time ${pct(p.oneTouch, p.relayed)}, after one touch ${pct(p.twoTouch, p.relayed)}`)
  console.log(`  on the ball: take-ons ${per90(p.takeOns)}/90, lost ${pct(p.takeOnsLost, p.takeOns)} | big touches ${per90(p.large)}/90, lost ${pct(p.largeLost, p.large)} | possessions ${per90(s[0].attacks + s[1].attacks)}/90`)
  const kinds = (['stand', 'slide', 'barge'] as ChallengeKind[]).map((k) => `${k} ${per90(p.challenges[k].n)}/90 won ${pct(p.challenges[k].won, p.challenges[k].n)} poked ${pct(p.challenges[k].poked, p.challenges[k].n)}`)
  console.log(`  challenges: ${kinds.join(' | ')}`)
  console.log(`  oddities: ${oddities.detectors.map((d) => `${d.name} ${((oddities.findings.filter((f) => f.detector === d.name).length * 90) / minutes).toFixed(0)}/90`).join(', ')}`)
  const systems = [...spent].sort((a, b) => b[1] - a[1]).map(([name, time]) => `${name} ${(time / minutes).toFixed(1)}`)
  console.log(`  cost: ${(ms / minutes).toFixed(0)} ms per sim-minute | ${systems.join(', ')}`)
  for (const [name, time] of spent) totals.set(name, (totals.get(name) ?? 0) + time / minutes / seeds.length)
}
const all = [...totals.values()].reduce((a, b) => a + b, 0)
console.log(`mean: ${all.toFixed(0)} ms of systems per sim-minute | ${[...totals].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, t]) => `${n} ${pct(t, all)}`).join(', ')}`)

/** One fixed step, timing each system. */
function step(world: Match, spent: Map<string, number>) {
  world.time += FIXED_DT
  world.phaseTime += FIXED_DT
  for (const [name, system] of MATCH_SYSTEMS) {
    const t0 = performance.now()
    system(world, FIXED_DT)
    spent.set(name, (spent.get(name) ?? 0) + performance.now() - t0)
  }
  if (world.indirectTaker !== -1 && world.lastTouchedBy !== world.indirectTaker) world.indirectTaker = -1
}

type Tally = Record<string, number>

/**
 * Follows the ball in play through cues and per-step checks: each pass (its
 * length, direction, whether it goes straight back to whoever played it, and
 * how many touches the passer took first), each take-on and big touch and
 * whether the ball was lost before the player touched it again, and each
 * challenge and how it came out.
 */
function watchPlay(world: Match) {
  const tally = {
    passes: 0, passLength: 0, long: 0, progressive: 0, backward: 0, returned: 0, relayed: 0, oneTouch: 0, twoTouch: 0,
    takeOns: 0, takeOnsLost: 0, large: 0, largeLost: 0,
    challenges: Object.fromEntries((['stand', 'slide', 'barge'] as ChallengeKind[]).map((k) => [k, { n: 0, won: 0, poked: 0 }])) as Record<ChallengeKind, { n: number; won: number; poked: number }>,
  }
  // Touches by the carrier since they got the ball, and the last pass's passer and receiver.
  let touches = 0
  let passerTouches = 0
  let lastPass = { from: -1, to: -1 }
  let lastTouch = world.lastTouch
  let lastChallenge = world.lastChallenge
  // A take-on or big touch whose outcome isn't known yet: lost if the other team gets the ball first.
  let takingOn = -1
  let knocked = -1
  let takeOnSide = 0
  world.onCue = (c) => {
    // The pass hands the ball to the receiver before it's announced, so keep the passer's count.
    if (c.kind === 'carrier' && c.player !== c.previous) {
      passerTouches = touches
      touches = 0
    }
    if (c.kind === 'possession') {
      lastPass = { from: -1, to: -1 }
      if (takingOn !== -1) tally.takeOnsLost++
      if (knocked !== -1) tally.largeLost++
      takingOn = knocked = -1
    }
    // Outfielders' passes only: a keeper's roll-out isn't one.
    const pass = world.pass
    if (c.kind !== 'passStruck' || !pass) return
    const team = world.possession
    const length = Math.hypot(pass.x - Position.x[world.ball], pass.y - Position.y[world.ball])
    const gain = along(team, pass.x) - along(team, Position.x[world.ball])
    tally.passes++
    tally.passLength += length
    if (length > 30) tally.long++
    if (gain >= 10) tally.progressive++
    if (gain <= -2) tally.backward++
    if (lastPass.from === c.receiver && lastPass.to === c.passer) tally.returned++
    // Touches before passing on a pass they received, not a ball won or a restart.
    if (lastPass.to === c.passer) {
      tally.relayed++
      if (passerTouches === 0) tally.oneTouch++
      else if (passerTouches === 1) tally.twoTouch++
    }
    lastPass = { from: c.passer, to: c.receiver }
  }
  return {
    tally,
    afterStep() {
      if (world.lastTouch !== lastTouch && world.lastTouch) {
        const by = world.lastTouch.by
        if (by === world.carrier) touches++
        if (by === knocked) knocked = -1
        if (world.lastTouch.style === TouchStyle.Large && TakeOn.side[by] === 0) {
          tally.large++
          knocked = by
        }
      }
      lastTouch = world.lastTouch
      if (world.lastChallenge !== lastChallenge && world.lastChallenge) {
        const c = tally.challenges[world.lastChallenge.kind]
        c.n++
        if (world.lastChallenge.result === 'won') c.won++
        if (world.lastChallenge.result === 'poked') c.poked++
      }
      lastChallenge = world.lastChallenge
      // A take-on starts once the carrier is working their man from within TAKE_ON_COUNTED, and lasts until
      // they're round him or give it up, or the ball moves on.
      const gap = Math.hypot(Position.x[world.presser] - Position.x[world.ball], Position.y[world.presser] - Position.y[world.ball])
      const side = world.phase === 'play' && (takingOn !== -1 || gap < TAKE_ON_COUNTED) ? TakeOn.side[world.carrier] : 0
      if (takingOn !== -1 && (takingOn !== world.carrier || side === 0)) takingOn = -1
      if (takingOn === -1 && side !== 0 && side !== takeOnSide) {
        tally.takeOns++
        takingOn = world.carrier
      }
      takeOnSide = side
      if (world.phase !== 'play') takingOn = knocked = -1
    },
  }
}

/** Ten times a second of open play: effort, direction changes, spacing and shape. */
function sample(world: Match, t: Tally, heading: Map<number, number>) {
  for (const team of [0, 1]) {
    const squad = world.teams[team].outfielders
    for (let i = 0; i < squad.length; i++) {
      for (let j = i + 1; j < squad.length; j++) {
        t.pairs++
        if (Math.hypot(Position.x[squad[i]] - Position.x[squad[j]], Position.y[squad[i]] - Position.y[squad[j]]) < 3) t.bunched++
      }
    }
    const us = squad.map((e) => along(team, Position.x[e]))
    const ys = squad.map((e) => Position.y[e])
    const depth = Math.max(...us) - Math.min(...us)
    const width = Math.max(...ys) - Math.min(...ys)
    if (team === world.possession) {
      t.attackDepth += depth
      t.attackWidth += width
    } else {
      t.defendDepth += depth
      t.defendWidth += width
    }
  }
  t.shapes++
  for (const team of [0, 1]) {
    for (const eid of world.teams[team].outfielders) {
      if (eid === world.carrier || eid === world.presser) continue
      const speed = Math.hypot(Velocity.x[eid], Velocity.y[eid])
      t.samples++
      if (speed < 2) t.walk++
      else if (speed < 4.5) t.jog++
      else if (speed < 6.5) t.run++
      else t.sprint++
      // A reversal: moving with purpose, and now heading more than 120° away from a tenth of a second ago.
      const angle = Math.atan2(Velocity.y[eid], Velocity.x[eid])
      const before = heading.get(eid)
      if (speed > 1.5 && before !== undefined && Math.abs(Math.atan2(Math.sin(angle - before), Math.cos(angle - before))) > (2 * Math.PI) / 3) t.reversals++
      heading.set(eid, speed > 1.5 ? angle : (before ?? angle))
      if (team === world.possession) {
        t.attackers++
        if (along(team, Position.x[eid]) <= onsideLimit(world, team) + 1) t.onside++
      } else {
        t.defenders++
        const goal = ownGoalX(world.pitch, team)
        if (Math.hypot(goal - Position.x[eid], Position.y[eid]) <= Math.hypot(goal - Position.x[world.ball], Position.y[world.ball]) + 1) t.goalSide++
      }
    }
  }
}

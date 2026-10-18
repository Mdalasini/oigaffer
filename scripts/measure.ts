// Plays headless matches and reports how they played and what they cost.
//
//   bun scripts/measure.ts [minutes=30] [outfielders=4] [seeds=1,2,3]
//
// Per seed: the scoreline and tallies; how hard players off the ball work,
// how often teammates bunch, how often defenders are goal-side and attackers
// onside; each team's shape; and how long each system took per simulated
// minute, so a change can be judged on gameplay and performance together.
import { Position, Velocity } from '../src/sim/components'
import { createMatch, MATCH_SYSTEMS, type Match } from '../src/sim/match'
import { FIXED_DT } from '../src/sim/constants'
import { pitchFor } from '../src/sim/pitch'
import { along, onsideLimit } from '../src/sim/shape'
import { ownGoalX } from '../src/sim/teams'

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
  const start = performance.now()
  for (let tick = 0; world.time < minutes * 60; tick++) {
    step(world, spent)
    if (tick % 12 || world.phase !== 'play') continue
    sample(world, tally, heading)
  }
  const ms = performance.now() - start
  const s = world.stats
  console.log(`seed ${seed}: goals ${s[0].goals}-${s[1].goals} shots ${s[0].shots}/${s[1].shots} saved ${s[0].saved}/${s[1].saved} passes ${s[0].passes}/${s[1].passes} done ${pct(s[0].completed, s[0].passes)}/${pct(s[1].completed, s[1].passes)} offsides ${s[0].offsides + s[1].offsides} won ${s[0].won}/${s[1].won}`)
  const t = tally
  console.log(`  off the ball: walk ${pct(t.walk, t.samples)} jog ${pct(t.jog, t.samples)} run ${pct(t.run, t.samples)} sprint ${pct(t.sprint, t.samples)} | reversals ${(t.reversals / (t.samples / 10)).toFixed(2)}/player-s | bunched ${pct(t.bunched, t.pairs)} goal-side ${pct(t.goalSide, t.defenders)} onside ${pct(t.onside, t.attackers)}`)
  console.log(`  shape: attack ${(t.attackDepth / t.shapes).toFixed(1)} m deep x ${(t.attackWidth / t.shapes).toFixed(1)} m wide | defence ${(t.defendDepth / t.shapes).toFixed(1)} x ${(t.defendWidth / t.shapes).toFixed(1)}`)
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

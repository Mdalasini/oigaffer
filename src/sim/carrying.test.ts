import { describe, expect, test } from 'bun:test'
import { Facing, Position, TakeOn, Velocity } from './components'
import { createMatch, setVec, stepMatch, type GradeOverrides } from './match'
import { lookAround } from './perception'
import { planCarry } from './carrying'
import { attackedGoalX } from './teams'
import { FOOT_OFFSET } from './touch'

/**
 * Share of 40 seeds in which a one-a-side carrier, `fromGoal` m out and
 * standing with the ball, takes on the defender `gap` m in front of them and
 * `across` m to the side within two seconds: works him from within 3 m.
 */
function takesOn(fromGoal: number, gap: number, across = 0, grades: GradeOverrides = {}) {
  let n = 0
  for (let seed = 1; seed <= 40; seed++) {
    const world = createMatch({ outfielders: 1, seed, grades })
    const { carrier, presser, ball } = world
    const dir = Math.sign(attackedGoalX(world.pitch, 0))
    const x = attackedGoalX(world.pitch, 0) - dir * fromGoal
    setVec(Position, carrier, x, 0, 0)
    setVec(Velocity, carrier, 0, 0, 0)
    Facing.angle[carrier] = dir > 0 ? 0 : Math.PI
    setVec(Position, ball, x + dir * (FOOT_OFFSET + 0.1), 0, Position.z[ball])
    setVec(Velocity, ball, 0, 0, 0)
    setVec(Position, presser, x + dir * gap, across, 0)
    Facing.angle[presser] = dir > 0 ? Math.PI : 0
    lookAround(world)
    let took = false
    for (let i = 0; i < 240 && world.carrier === carrier && world.phase === 'play'; i++) {
      stepMatch(world)
      const near = Math.hypot(Position.x[presser] - Position.x[ball], Position.y[presser] - Position.y[ball]) < 3
      took ||= near && TakeOn.side[carrier] !== 0
    }
    if (took) n++
  }
  return n / 40
}

describe('carrying the ball', () => {
  test('in midfield, with room either side, a carrier usually goes round the defender rather than taking him on', () => {
    // Measured: every time when taking him on was all a carrier did; now 35% square on, 28% with him coming from the side.
    expect(takesOn(40, 5)).toBeLessThan(0.5)
    expect(takesOn(40, 4, 2.5)).toBeLessThan(0.5)
  })

  test('isolated against the last defender near goal, a good dribbler against a poor tackler takes him on', () => {
    const grades = { red: { outfielder: { dribbling: 20 } }, blue: { outfielder: { tackling: 3 } } }
    expect(takesOn(20, 5, 0, grades)).toBeGreaterThan(0.5)
  })

  test('the man to beat is the one the carrier reckons is on them, whoever is really closing in', () => {
    const world = createMatch({ outfielders: 2, seed: 1 })
    const { carrier, ball } = world
    const [seen, unseen] = world.teams[1].outfielders
    setVec(Position, carrier, 0, 0, 0)
    setVec(Velocity, carrier, 0, 0, 0)
    Facing.angle[carrier] = 0
    setVec(Position, ball, FOOT_OFFSET + 0.1, 0, Position.z[ball])
    setVec(Velocity, ball, 0, 0, 0)
    setVec(Position, world.teams[0].outfielders[1], -20, 10, 0)
    setVec(Position, seen, 4, 1, 0)
    setVec(Position, unseen, -12, 0, 0)
    lookAround(world)
    world.presser = seen
    const before = { ...planCarry(world, carrier) }
    // The other has really taken over the press, behind the carrier's back: nothing they know of has changed.
    world.presser = unseen
    expect(planCarry(world, carrier)).toEqual(before)
  })
})

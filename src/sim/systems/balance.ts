import { query } from 'bitecs'
import { OffBalance } from '../components'
import type { Match } from '../match'

/** Players regain their balance over time. Runs first in the step, like the touch cooldowns. */
export function balanceSystem(world: Match, dt: number) {
  for (const eid of query(world, [OffBalance])) OffBalance.timer[eid] = Math.max(0, OffBalance.timer[eid] - dt)
}

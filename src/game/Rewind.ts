import { FIXED_DT } from '../sim/constants'
import { stepMatch, type Match } from '../sim/match'
import { applyInput, ticksAt, type Replay } from '../sim/replay'
import { restoreState, saveState, type SavedState } from '../sim/snapshot'
import { stateHash } from '../sim/state'

/** Saved states are taken this often (steps), and this many kept: two minutes' worth. */
const SAVE_EVERY = ticksAt(1)
const SAVES_KEPT = 120

interface Save {
  tick: number
  state: SavedState
  /** The live match's state hash then, to check a replay against. */
  hash: string
}

/**
 * Lets the live match be wound back over its last two minutes: it keeps a
 * saved state every second, and gets to any step between them by restoring
 * the one before and playing on, with the inputs made since.
 */
export class Rewind {
  private readonly saves: Save[] = []

  constructor(
    private readonly match: Match,
    private readonly record: Replay,
  ) {
    this.save(0)
  }

  /** Call after each live step, with the steps taken so far. */
  stepped(tick: number) {
    if (tick % SAVE_EVERY === 0) this.save(tick)
  }

  /** The earliest step it can go back to. */
  get earliest() {
    return this.saves[0].tick
  }

  /** Puts the match as it was after `tick` steps. */
  seek(tick: number) {
    const save = this.saveAt(tick)
    restoreState(this.match, save.state)
    for (let t = save.tick; t < tick; t++) this.step(t)
  }

  /** Plays one step on from `tick`, applying the inputs made then. */
  step(tick: number) {
    for (const input of this.record.inputs) if (input.tick === tick) applyInput(this.match, input)
    stepMatch(this.match, FIXED_DT)
  }

  /** The last live state hash saved at or before `tick`. */
  checkpoint(tick: number): { tick: number; hash: string } {
    const save = this.saveAt(tick)
    return { tick: save.tick, hash: save.hash }
  }

  /** The last save at or before `tick`, or the earliest kept. */
  private saveAt(tick: number): Save {
    let i = this.saves.length - 1
    while (i > 0 && this.saves[i].tick > tick) i--
    return this.saves[i]
  }

  private save(tick: number) {
    this.saves.push({ tick, state: saveState(this.match), hash: stateHash(this.match) })
    if (this.saves.length > SAVES_KEPT) this.saves.shift()
  }
}

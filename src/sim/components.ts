// Component stores. Every store is a typed array indexed by entity id so the
// whole ECS can be snapshotted by copying arrays. Stores belong to one Sim
// (not module scope) so headless replays and tests can run several worlds.

export const MAX_ENTITIES = 32

const f64 = () => new Float64Array(MAX_ENTITIES)
const i32 = () => new Int32Array(MAX_ENTITIES)

export function createComponents() {
  return {
    Pos: { x: f64(), y: f64() },
    Vel: { x: f64(), y: f64() },
    /** Ball height and vertical velocity. */
    Air: { z: f64(), vz: f64() },
    /** Body orientation in radians. */
    Facing: { a: f64() },
    Player: { team: i32(), slot: i32(), number: i32() },
    /** Ratings in [0, 1]. Constant for the match. */
    Attr: {
      pace: f64(),
      accel: f64(),
      agility: f64(),
      strength: f64(),
      passing: f64(),
      vision: f64(),
      firstTouch: f64(),
      dribbling: f64(),
      shooting: f64(),
      tackling: f64(),
      positioning: f64(),
      composure: f64(),
      aggression: f64(),
      reactions: f64(),
      keeping: f64(),
    },
    /** Where locomotion steers the player this tick. */
    Motor: { tx: f64(), ty: f64(), speed: f64(), faceX: f64(), faceY: f64(), hasFace: i32() },
    /** The player's current plan; see intents.ts. */
    Intent: { kind: i32(), target: i32(), x: f64(), y: f64(), since: i32() },
    Brain: { nextThink: i32(), noTouchUntil: i32(), lastTouch: i32() },
  }
}

export type Components = ReturnType<typeof createComponents>

/** Every typed array in the stores, in a fixed order, for snapshots. */
export function componentArrays(c: Components): (Float64Array | Int32Array)[] {
  const out: (Float64Array | Int32Array)[] = []
  for (const store of Object.values(c)) for (const arr of Object.values(store)) out.push(arr)
  return out
}

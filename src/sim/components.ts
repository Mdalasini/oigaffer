// Component stores. Every store is a typed array indexed by entity id so the
// whole ECS can be snapshotted by copying arrays. Stores belong to one Sim
// (not module scope) so headless replays and tests can run several worlds.

export const MAX_ENTITIES = 32

const f64 = () => new Float64Array(MAX_ENTITIES)
const i32 = () => new Int32Array(MAX_ENTITIES)
/** One value per (observer, target) pair, indexed observer * MAX_ENTITIES + target. */
const pairF64 = () => new Float64Array(MAX_ENTITIES * MAX_ENTITIES)
const pairI32 = () => new Int32Array(MAX_ENTITIES * MAX_ENTITIES)

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
    Intent: { kind: i32(), target: i32(), x: f64(), y: f64(), since: i32(), mode: i32() },
    /** The ball action a player will make when they get to the ball; type -1 = none. */
    Plan: { type: i32(), target: i32(), x: f64(), y: f64(), z: f64(), firstTime: i32() },
    Brain: {
      nextThink: i32(),
      noTouchUntil: i32(),
      lastTouch: i32(),
      nextScan: i32(),
      nextCall: i32(),
      /** A teammate who asked this player to play the ball straight back, and until when. */
      wallFor: i32(),
      wallUntil: i32(),
      /** Tick the player last brought the ball under control. */
      gotBall: i32(),
      /** No more "man on" warnings to this player until this tick. */
      warnedUntil: i32(),
      /** Earliest tick this player may commit to another challenge. */
      tackleReady: i32(),
      /** Earliest tick this player may start another off-ball run. */
      runReady: i32(),
      /** Earliest tick a carrier considers taking a man on again. */
      takeOnReady: i32(),
      /** Until this tick the carrier has made up their mind to take on the man in front, given the chance. */
      takeOnKeen: i32(),
      /** Earliest tick a jockeying defender weighs up going in again. */
      commitCheck: i32(),
    },
    /** Lunging (a slide in progress), on the ground afterwards, or stumbling after a challenge. */
    Body: { lungeUntil: i32(), downUntil: i32(), stumbleUntil: i32() },
    /** A player's assigned spot for the current set piece, if they have one. */
    SetPiece: { active: i32(), x: f64(), y: f64() },
    /** Goalkeeper dive state: a pending dive (tick, target) and how long the dive and recovery last. */
    Keeper: { diveAt: i32(), diveUntil: i32(), downUntil: i32(), x: f64(), y: f64() },
    /** What each player last perceived of every other entity, and on which tick. */
    Memory: { x: pairF64(), y: pairF64(), z: pairF64(), vx: pairF64(), vy: pairF64(), vz: pairF64(), seen: pairI32() },
  }
}

export type Components = ReturnType<typeof createComponents>

/** Every typed array in the stores, in a fixed order, for snapshots. */
export function componentArrays(c: Components): (Float64Array | Int32Array)[] {
  const out: (Float64Array | Int32Array)[] = []
  for (const store of Object.values(c)) for (const arr of Object.values(store)) out.push(arr)
  return out
}

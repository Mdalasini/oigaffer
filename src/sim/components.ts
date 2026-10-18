const MAX_ENTITIES = 64

const vec3 = () => ({
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
  z: new Float32Array(MAX_ENTITIES),
})

export const Position = vec3()
export const Velocity = vec3()

/** Physical size of a player, used for drawing and for keeper reach. */
export const Body = {
  radius: new Float32Array(MAX_ENTITIES),
  height: new Float32Array(MAX_ENTITIES),
}

/** Which way the body faces in the ground plane, radians from +x. */
export const Facing = {
  angle: new Float32Array(MAX_ENTITIES),
}

/** Physical grades (1–20) that limit how a player can move. */
export const Physical = {
  pace: new Uint8Array(MAX_ENTITIES),
  acceleration: new Uint8Array(MAX_ENTITIES),
  agility: new Uint8Array(MAX_ENTITIES),
  strength: new Uint8Array(MAX_ENTITIES),
}

/**
 * What a player wants to do this tick, written by its decision-making and
 * carried out by the locomotion system within the player's physical limits.
 */
export const MoveIntent = {
  /** Desired ground velocity (m/s). */
  vx: new Float32Array(MAX_ENTITIES),
  vy: new Float32Array(MAX_ENTITIES),
  /** Direction to face; (0, 0) means face the way you are going. */
  faceX: new Float32Array(MAX_ENTITIES),
  faceY: new Float32Array(MAX_ENTITIES),
}

export const Ball = {}

export const Outfielder = {
  shooting: new Uint8Array(MAX_ENTITIES),
  /** Touch accuracy: how true the ball goes where the player meant it to. */
  dribbling: new Uint8Array(MAX_ENTITIES),
  /** How quickly a defender reads the ball carrier's changes of direction. */
  marking: new Uint8Array(MAX_ENTITIES),
  /** How often a tackle comes away with the ball. */
  tackling: new Uint8Array(MAX_ENTITIES),
}

/** Knocked off balance: can't play the ball and barely accelerates until the timer runs out. */
export const OffBalance = {
  timer: new Float32Array(MAX_ENTITIES),
}

/** On the deck: slid in or brought down. Moves under its own momentum, not by choice. */
export const Sliding = {}

/** The carrier putting their body between the defender and the ball. */
export const Shield = {
  active: new Uint8Array(MAX_ENTITIES),
  /** While shielding: seconds left before turning away. Otherwise: seconds before shielding again. */
  timer: new Float32Array(MAX_ENTITIES),
}

export const TouchStyle = {
  None: 0,
  /** Ball kept close: wide range of directions, quick to play again, costs some speed. */
  Small: 1,
  /** Ball knocked ahead to run onto: only roughly forwards, but no loss of stride. */
  Large: 2,
  /** Ball rolled under the sole, kept tight at the feet while shielding. */
  Shield: 3,
} as const
export type TouchStyle = (typeof TouchStyle)[keyof typeof TouchStyle]

/** A player who can play the ball with touches while running. */
export const Dribbler = {
  /** The touch to play the next time the ball is at the player's feet. */
  style: new Uint8Array(MAX_ENTITIES),
  /** Direction to send the ball with that touch. */
  dirX: new Float32Array(MAX_ENTITIES),
  dirY: new Float32Array(MAX_ENTITIES),
  /** Seconds before the player can play another touch. */
  cooldown: new Float32Array(MAX_ENTITIES),
}

export const DefenderMode = {
  /** Side-on, facing the ball: small, quick shuffles that mirror the carrier. */
  Jockey: 0,
  /** Facing where they're going: fast, but slow to read and to turn. */
  Run: 1,
  /** A stab at the ball from on their feet: short reach, quick to recover. */
  StandTackle: 2,
  /** Sliding in: long reach, but they end up on the ground. */
  SlideTackle: 3,
  /** A shoulder into the carrier, to knock them off the ball. */
  Barge: 4,
  /** Getting back up after a slide. */
  Grounded: 5,
} as const
export type DefenderMode = (typeof DefenderMode)[keyof typeof DefenderMode]

/** A player defending against the ball carrier. */
export const Defender = {
  mode: new Uint8Array(MAX_ENTITIES),
  /**
   * Where the defender believes the ball is and how it's moving. The read
   * trails the real ball by the defender's reaction time, so cuts and
   * knock-ons take a moment to register.
   */
  readX: new Float32Array(MAX_ENTITIES),
  readY: new Float32Array(MAX_ENTITIES),
  readVx: new Float32Array(MAX_ENTITIES),
  readVy: new Float32Array(MAX_ENTITIES),
  /** Seconds into the current tackle, barge or recovery. */
  actionTime: new Float32Array(MAX_ENTITIES),
  /** Direction of a slide. */
  actionDirX: new Float32Array(MAX_ENTITIES),
  actionDirY: new Float32Array(MAX_ENTITIES),
  /** Whether the current challenge has already met the ball or player. */
  contacted: new Uint8Array(MAX_ENTITIES),
}

/** The ball carrier's plan for beating the defender in front of them. */
export const TakeOn = {
  /** Which way to go round: +1 to the defender's left (+y side), -1 to the right. */
  side: new Int8Array(MAX_ENTITIES),
  /** Seconds left selling a dummy the wrong way before the real cut. */
  feintTimer: new Float32Array(MAX_ENTITIES),
  /** Seconds left cutting this way before checking back if the defender has mirrored it. */
  checkBackTimer: new Float32Array(MAX_ENTITIES),
}

export const Goalkeeper = {
  reaction: new Uint8Array(MAX_ENTITIES),
  /** Seconds left before the keeper may react to the current shot. */
  reactTimer: new Float32Array(MAX_ENTITIES),
}

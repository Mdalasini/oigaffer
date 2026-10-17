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
}

export const Goalkeeper = {
  reaction: new Uint8Array(MAX_ENTITIES),
  /** Seconds left before the keeper may react to the current shot. */
  reactTimer: new Float32Array(MAX_ENTITIES),
}

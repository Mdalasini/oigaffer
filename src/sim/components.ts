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

export const Ball = {}

export const Outfielder = {
  shooting: new Uint8Array(MAX_ENTITIES),
}

export const Goalkeeper = {
  reaction: new Uint8Array(MAX_ENTITIES),
  /** Seconds left before the keeper may react to the current shot. */
  reactTimer: new Float32Array(MAX_ENTITIES),
}

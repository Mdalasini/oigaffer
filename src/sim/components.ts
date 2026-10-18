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

/** Which side a player is on: team 0 attacks the goal at +x, team 1 the goal at -x. */
export const Team = {
  id: new Uint8Array(MAX_ENTITIES),
}

/** The outfielder on the ball: carries it, takes the defender on and shoots. */
export const OnBall = {}

/** The opponent engaging the carrier: jockeys, challenges and tries to win the ball back. */
export const Pressing = {}

export const Outfielder = {
  shooting: new Uint8Array(MAX_ENTITIES),
  /** Touch accuracy: how true the ball goes where the player meant it to. */
  dribbling: new Uint8Array(MAX_ENTITIES),
  /** How quickly a defender reads the ball carrier's changes of direction. */
  marking: new Uint8Array(MAX_ENTITIES),
  /** How often a tackle comes away with the ball. */
  tackling: new Uint8Array(MAX_ENTITIES),
  /** How true a pass goes, in direction and weight. */
  passing: new Uint8Array(MAX_ENTITIES),
  /** How cleanly a pass is brought under control, and how fast a ball can be taken. */
  firstTouch: new Uint8Array(MAX_ENTITIES),
  /** How much of the pitch a player takes in: teammates they spot outside their field of view. */
  vision: new Uint8Array(MAX_ENTITIES),
  /** How reliably a player picks the best option they've seen. */
  decisions: new Uint8Array(MAX_ENTITIES),
  /** How well a player finds space and times runs without the ball. */
  offTheBall: new Uint8Array(MAX_ENTITIES),
  /** How well a defender keeps track of the runner they're marking, even one going behind them. */
  positioning: new Uint8Array(MAX_ENTITIES),
}

/**
 * A defender's job, as their team has shared the jobs out: the attacker
 * they're responsible for (-1 for none), or covering behind the presser.
 * With neither, they hold their zone.
 */
export const Mark = {
  target: new Int16Array(MAX_ENTITIES),
  cover: new Uint8Array(MAX_ENTITIES),
}

export const RunPhase = {
  None: 0,
  /** Checking away from the marker before going. */
  Prepare: 1,
  /** Running into the space, staying onside until the pass. */
  Go: 2,
} as const
export type RunPhase = (typeof RunPhase)[keyof typeof RunPhase]

/** A run in behind: where to, how far through it, and how long before the next. */
export const Run = {
  phase: new Uint8Array(MAX_ENTITIES),
  /** Seconds left in the current phase. */
  timer: new Float32Array(MAX_ENTITIES),
  /** Seconds before they'll make another run. */
  rest: new Float32Array(MAX_ENTITIES),
  targetX: new Float32Array(MAX_ENTITIES),
  targetY: new Float32Array(MAX_ENTITIES),
  /** Match time at which they burst for a through ball being shaped for them, judged from the passer's shape. */
  burstAt: new Float32Array(MAX_ENTITIES),
}

export const CallKind = {
  None: 0,
  /** "Here!": wants it played to feet. */
  Feet: 1,
  /** "In behind!": wants it played into the space at (x, y). */
  Space: 2,
} as const
export type CallKind = (typeof CallKind)[keyof typeof CallKind]

/** A player calling for the ball. The carrier hears a call even from a teammate they can't see. */
export const Call = {
  kind: new Uint8Array(MAX_ENTITIES),
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
}

/**
 * Set when a teammate last played the ball while this player was in an
 * offside position. Getting involved while it's set is an offence.
 */
export const Offside = {
  flagged: new Uint8Array(MAX_ENTITIES),
}

/** A player on the ball looking for a pass: the match time at which they next weigh their options. */
export const Passer = {
  nextLook: new Float32Array(MAX_ENTITIES),
  /** Who last passed the ball to them (-1 if nobody), and the match time they took it. */
  receivedFrom: new Int32Array(MAX_ENTITIES),
  receivedAt: new Float32Array(MAX_ENTITIES),
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
  /** Seconds before they may challenge: a player who has just lost the ball needs a moment to turn. */
  challengeDelay: new Float32Array(MAX_ENTITIES),
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

/** Where a carrier keeping the ball means to take it, decided a few times a second (see `chooseCarry`). */
export const Carry = {
  /** Unit direction to carry it. */
  dirX: new Float32Array(MAX_ENTITIES),
  dirY: new Float32Array(MAX_ENTITIES),
  /** 1 if that means taking on the defender in the way, rather than going round him. */
  takeOn: new Uint8Array(MAX_ENTITIES),
  /** Match time of the next rethink. */
  nextLook: new Float32Array(MAX_ENTITIES),
}

/** A player's place in their team's formation: an index into its slots. */
export const Slot = {
  index: new Uint8Array(MAX_ENTITIES),
}

export const Effort = {
  Walk: 0,
  Jog: 1,
  Run: 2,
  Sprint: 3,
} as const
export type Effort = (typeof Effort)[keyof typeof Effort]

/**
 * What an outfielder without a job on the ball is doing: where they're
 * heading, how close counts as there, and how hard they're working to get
 * there. Re-decided a few times a second, not every tick.
 */
export const OffBall = {
  targetX: new Float32Array(MAX_ENTITIES),
  targetY: new Float32Array(MAX_ENTITIES),
  /** Within this distance (m) of the target they stop and hold. */
  radius: new Float32Array(MAX_ENTITIES),
  effort: new Uint8Array(MAX_ENTITIES),
  /** Whether they've arrived and are holding, until pulled far enough away. */
  settled: new Uint8Array(MAX_ENTITIES),
  /** Seconds until they next reconsider. */
  decideIn: new Float32Array(MAX_ENTITIES),
  /** An attacker's current intention: holding the shape (0) or showing for the ball (1). */
  showing: new Uint8Array(MAX_ENTITIES),
  /** Where, from their place in the shape (m), an attacker holding it has moved to open a lane for a pass. */
  laneX: new Float32Array(MAX_ENTITIES),
  laneY: new Float32Array(MAX_ENTITIES),
}

export const Goalkeeper = {
  reaction: new Uint8Array(MAX_ENTITIES),
  /** How often a shot within reach is held rather than parried. */
  handling: new Uint8Array(MAX_ENTITIES),
  /** Seconds left before the keeper may react to the current shot. */
  reactTimer: new Float32Array(MAX_ENTITIES),
  /** Seconds before the keeper can gather the ball again, after parrying it or rolling it out. */
  recover: new Float32Array(MAX_ENTITIES),
  /** With the ball in their hands: when they next look for who to roll it to, who that is, and how safe the pass looked. */
  nextLook: new Float32Array(MAX_ENTITIES),
  receiver: new Int32Array(MAX_ENTITIES),
  safety: new Float32Array(MAX_ENTITIES),
}

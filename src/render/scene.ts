import { hasComponent } from 'bitecs'
import { Body, Call, CallKind, Defender, DefenderMode, Facing, Goalkeeper, OffBalance, Position, Sliding, Team, TouchStyle, Velocity } from '../sim/components'
import {
  BALL_RADIUS,
  CIRCLE_RADIUS,
  GOAL_AREA_DEPTH,
  GOAL_AREA_HALF_WIDTH,
  GOAL_DEPTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  GOAL_X,
  PENALTY_AREA_DEPTH,
  PENALTY_AREA_HALF_WIDTH,
  PENALTY_SPOT_DISTANCE,
  PITCH_HALF_LENGTH,
  PITCH_HALF_WIDTH,
  POST_WIDTH,
} from '../sim/constants'
import { currentSpread, type Match, type ShotOutcome } from '../sim/match'
import { chooseAim, type GoalPoint, type Vec3 } from '../sim/shooting'
import { attackedGoalX } from '../sim/teams'
import type { Batch, Color } from './batch'
import type { Camera } from './cameras'
import { drawOverlay, type Overlay } from './overlay'

const GRASS: Color = [0.18, 0.47, 0.22, 1]
const GRASS_STRIPE: Color = [0.2, 0.52, 0.24, 1]
const GRASS_OUTER: Color = [0.15, 0.4, 0.19, 1]
const LINE: Color = [0.95, 0.97, 0.95, 1]
const POST: Color = [0.97, 0.97, 0.97, 1]
const NET_FILL: Color = [1, 1, 1, 0.08]
const NET_LINE: Color = [1, 1, 1, 0.35]
const SHADOW: Color = [0, 0, 0, 0.28]
const SKIN: Color = [0.86, 0.68, 0.53, 1]
const HAIR: Color = [0.18, 0.12, 0.08, 1]
const BOOT: Color = [0.08, 0.08, 0.08, 1]
const OFF_BALANCE_RING: Color = [1, 0.85, 0.2, 0.85]
const BALL_FILL: Color = [1, 1, 1, 1]
const BALL_EDGE: Color = [0.1, 0.1, 0.1, 1]
const AIM: Color = [1, 0.85, 0.25, 1]
const AIM_FILL: Color = [1, 0.85, 0.25, 0.16]
const SMALL_TOUCH: Color = [0.4, 0.9, 1, 1]
const LARGE_TOUCH: Color = [1, 0.6, 0.25, 1]
const PASS_LINE: Color = [1, 1, 1, 0.25]
const CALL_RING: Color = [1, 0.95, 0.4, 0.7]
const CALL_LINE: Color = [1, 0.95, 0.4, 0.3]
const PASS_RING: Color = [1, 1, 1, 0.8]
/** Seconds a touch ring stays on screen. */
const TOUCH_RING_LIFE = 0.45

type Kit = { shirt: Color; shorts: Color; socks: Color }
/** Outfield and keeper kits for each team, by team id: red then blue. */
const KITS: { outfield: Kit; keeper: Kit }[] = [
  {
    outfield: { shirt: [0.84, 0.2, 0.22, 1], shorts: [0.95, 0.95, 0.95, 1], socks: [0.84, 0.2, 0.22, 1] },
    keeper: { shirt: [0.78, 0.9, 0.2, 1], shorts: [0.1, 0.1, 0.12, 1], socks: [0.78, 0.9, 0.2, 1] },
  },
  {
    outfield: { shirt: [0.22, 0.42, 0.9, 1], shorts: [0.95, 0.95, 0.95, 1], socks: [0.22, 0.42, 0.9, 1] },
    keeper: { shirt: [0.98, 0.55, 0.15, 1], shorts: [0.1, 0.1, 0.12, 1], socks: [0.98, 0.55, 0.15, 1] },
  },
]

const SHOT_COLOR: Record<ShotOutcome, Color> = {
  goal: [0.25, 0.9, 0.4, 1],
  caught: [0.35, 0.65, 1, 1],
  parried: [0.35, 0.65, 1, 1],
  blocked: [1, 0.35, 0.3, 1],
  wide: [1, 0.35, 0.3, 1],
  over: [1, 0.35, 0.3, 1],
}

/** Shadows fall away from a sun high to the south-east. */
const SUN = { x: -0.45, y: -0.3 }

/** The two ends of the pitch, by the sign of their goal line's x. */
const ENDS = [-1, 1]

const X = { x: 1, y: 0, z: 0 }
const Y = { x: 0, y: 1, z: 0 }
const Z = { x: 0, y: 0, z: 1 }

export function buildScene(batch: Batch, world: Match, cam: Camera, overlay: Overlay = 'off') {
  batch.clear()
  drawGround(batch)
  drawMarkings(batch)
  drawOverlay(batch, world, overlay)
  for (const end of ENDS) drawGoal(batch, end)
  for (const team of world.teams) {
    for (const eid of team.outfielders) drawPlayer(batch, cam, world, eid, KITS[Team.id[eid]].outfield)
    drawPlayer(batch, cam, world, team.keeper, KITS[Team.id[team.keeper]].keeper)
  }
  drawTouchRing(batch, world)
  drawPass(batch, world)
  drawCalls(batch, world)
  drawBall(batch, cam, world.ball)
  drawShotGuide(batch, world)
}

function drawGround(b: Batch) {
  const L = PITCH_HALF_LENGTH
  const W = PITCH_HALF_WIDTH
  b.quad({ x: 0, y: 0, z: -0.02 }, { x: L + 10, y: 0, z: 0 }, { x: 0, y: W + 8, z: 0 }, GRASS_OUTER)
  const stripes = 10
  const width = (2 * L) / stripes
  for (let i = 0; i < stripes; i++) {
    b.quad({ x: -L + (i + 0.5) * width, y: 0, z: -0.01 }, { x: width / 2, y: 0, z: 0 }, { x: 0, y: W, z: 0 }, i % 2 ? GRASS : GRASS_STRIPE)
  }
  // Seen face-on from the goal camera, the pitch is edge-on; these strips
  // behind each goal stand in for the ground there.
  for (const end of ENDS) b.quad({ x: end * (GOAL_X + 12), y: 0, z: -3 }, { x: 0, y: 40, z: 0 }, { x: 0, y: 0, z: 3 }, GRASS_OUTER)
}

function drawMarkings(b: Batch) {
  const w = 0.12
  const z = 0
  const line = (x0: number, y0: number, x1: number, y1: number) => b.groundLine(x0, y0, x1, y1, w, z, LINE)
  const L = PITCH_HALF_LENGTH
  const W = PITCH_HALF_WIDTH
  line(-L, -W, L, -W)
  line(-L, W, L, W)
  line(0, -W, 0, W)
  b.disc({ x: 0, y: 0, z }, X, Y, 0.2, LINE, 12)
  b.arc({ x: 0, y: 0, z }, X, Y, CIRCLE_RADIUS, w, 0, Math.PI * 2, LINE)

  for (const end of ENDS) {
    const goalLine = end * L
    line(goalLine, -W, goalLine, W)
    const box = (depth: number, halfWidth: number) => {
      const front = end * (L - depth)
      line(front, -halfWidth, front, halfWidth)
      line(front, -halfWidth, goalLine, -halfWidth)
      line(front, halfWidth, goalLine, halfWidth)
    }
    box(PENALTY_AREA_DEPTH, PENALTY_AREA_HALF_WIDTH)
    box(GOAL_AREA_DEPTH, GOAL_AREA_HALF_WIDTH)

    const spot = { x: end * (L - PENALTY_SPOT_DISTANCE), y: 0, z }
    b.disc(spot, X, Y, 0.2, LINE, 12)
    // The "D": the part of the penalty arc outside the area, facing the halfway line.
    const edge = Math.acos((PENALTY_AREA_DEPTH - PENALTY_SPOT_DISTANCE) / CIRCLE_RADIUS)
    const towardHalfway = end > 0 ? Math.PI : 0
    b.arc(spot, X, Y, CIRCLE_RADIUS, w, towardHalfway - edge, towardHalfway + edge, LINE, 24)
  }
}

/** Both goals: `end` is +1 for the goal at +x, -1 for the one at -x. */
function drawGoal(b: Batch, end: number) {
  const half = GOAL_HALF_WIDTH
  const pw = POST_WIDTH
  const span = (x0: number, x1: number) => [end * x0, end * x1].sort((a, c) => a - c)
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const [lo, hi] = span(x0, x1)
    b.box({ x: lo, y: y0, z: z0 }, { x: hi, y: y1, z: z1 }, POST)
  }
  for (const side of [-1, 1]) {
    const y = side * (half + pw / 2)
    box(GOAL_X, GOAL_X + pw, y - pw / 2, y + pw / 2, 0, GOAL_HEIGHT + pw)
  }
  box(GOAL_X, GOAL_X + pw, -half - pw, half + pw, GOAL_HEIGHT, GOAL_HEIGHT + pw)

  const back = end * (GOAL_X + GOAL_DEPTH)
  const mid = end * (GOAL_X + GOAL_DEPTH / 2)
  // Back, sides and roof of the net.
  b.quad({ x: back, y: 0, z: GOAL_HEIGHT / 2 }, { x: 0, y: half, z: 0 }, { x: 0, y: 0, z: GOAL_HEIGHT / 2 }, NET_FILL)
  for (const side of [-1, 1]) {
    b.quad({ x: mid, y: side * half, z: GOAL_HEIGHT / 2 }, { x: GOAL_DEPTH / 2, y: 0, z: 0 }, { x: 0, y: 0, z: GOAL_HEIGHT / 2 }, NET_FILL)
  }
  b.quad({ x: mid, y: 0, z: GOAL_HEIGHT }, { x: GOAL_DEPTH / 2, y: 0, z: 0 }, { x: 0, y: half, z: 0 }, NET_FILL)

  const mesh = 0.3
  const t = 0.015
  for (let y = -half; y <= half + 1e-6; y += mesh) {
    b.quad({ x: back, y, z: GOAL_HEIGHT / 2 }, { x: 0, y: t, z: 0 }, { x: 0, y: 0, z: GOAL_HEIGHT / 2 }, NET_LINE)
    b.quad({ x: mid, y, z: GOAL_HEIGHT }, { x: GOAL_DEPTH / 2, y: 0, z: 0 }, { x: 0, y: t, z: 0 }, NET_LINE)
  }
  for (let z = mesh; z < GOAL_HEIGHT; z += mesh) {
    b.quad({ x: back, y: 0, z }, { x: 0, y: half, z: 0 }, { x: 0, y: 0, z: t }, NET_LINE)
  }
  for (let d = mesh; d < GOAL_DEPTH; d += mesh) {
    b.quad({ x: end * (GOAL_X + d), y: 0, z: GOAL_HEIGHT }, { x: t, y: 0, z: 0 }, { x: 0, y: half, z: 0 }, NET_LINE)
  }
}

/** A player built from boxes turned to their facing, with a sphere for the head. */
function drawPlayer(b: Batch, cam: Camera, world: Match, eid: number, kit: Kit) {
  const x = Position.x[eid]
  const y = Position.y[eid]
  const yaw = Facing.angle[eid]
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const h = Body.height[eid]
  const r = Body.radius[eid]
  const hip = h * 0.48
  const shoulder = h * 0.82

  /** Box spanning z0..z1, centred at (forward, left) in the player's frame. */
  const part = (forward: number, left: number, z0: number, z1: number, depth: number, width: number, color: Color) =>
    b.orientedBox(
      { x: x + forward * cos - left * sin, y: y + forward * sin + left * cos, z: (z0 + z1) / 2 },
      { x: depth / 2, y: width / 2, z: (z1 - z0) / 2 },
      yaw,
      color,
    )

  if (OffBalance.timer[eid] > 0) b.arc({ x, y, z: 0.02 }, X, Y, r + 0.25, 0.07, 0, Math.PI * 2, OFF_BALANCE_RING, 24)
  if (hasComponent(world, eid, Sliding)) {
    drawLying(b, cam, x, y, cos, sin, part, kit)
    return
  }

  b.disc({ x: x + SUN.x * 0.6, y: y + SUN.y * 0.6, z: 0.01 }, X, Y, r * 1.1, SHADOW, 16)

  const stabbing = hasComponent(world, eid, Defender) && Defender.mode[eid] === DefenderMode.StandTackle
  for (const side of [-1, 1]) {
    // A standing tackle shoots the right leg out at the ball.
    if (stabbing && side === -1) {
      part(0.75, side * r * 0.35, 0, 0.1, 0.3, 0.12, BOOT)
      part(0.35, side * r * 0.35, 0.05, hip * 0.5, 0.6, 0.18, kit.socks)
      continue
    }
    const left = side * r * 0.35
    // Boots poke out in front of the body, so facing reads from overhead.
    part(0.1, left, 0, 0.1, 0.3, 0.12, BOOT)
    part(0, left, 0.1, hip * 0.55, 0.18, 0.18, kit.socks)
    part(0, left, hip * 0.55, hip, 0.2, 0.2, kit.shorts)
  }
  part(0, 0, hip, shoulder, r * 0.9, r * 2, kit.shirt)

  const headR = 0.13
  const head = { x, y, z: h - headR }
  b.disc(head, cam.right, cam.up, headR, SKIN, 16)
  // Hair sits on top and towards the back of the head.
  b.disc({ x: x - cos * 0.03, y: y - sin * 0.03, z: head.z + 0.06 }, X, Y, headR * 0.85, HAIR, 16)

  if (hasComponent(world, eid, Goalkeeper)) drawGloves(b, cam, eid, shoulder)
  else {
    for (const side of [-1, 1]) part(0, side * (r + 0.07), hip + 0.05, shoulder - 0.02, 0.14, 0.14, kit.shirt)
  }
}

type Part = (forward: number, left: number, z0: number, z1: number, depth: number, width: number, color: Color) => void

/** A player on the ground, boots first along their facing: sliding in or getting up. */
function drawLying(b: Batch, cam: Camera, x: number, y: number, cos: number, sin: number, part: Part, kit: Kit) {
  b.disc({ x: x + SUN.x * 0.2, y: y + SUN.y * 0.2, z: 0.01 }, X, Y, 0.6, SHADOW, 16)
  for (const side of [-1, 1]) {
    part(0.95, side * 0.12, 0, 0.12, 0.25, 0.12, BOOT)
    part(0.55, side * 0.12, 0.02, 0.18, 0.6, 0.16, kit.socks)
  }
  part(0.1, 0, 0.02, 0.22, 0.4, 0.42, kit.shorts)
  part(-0.35, 0, 0.04, 0.3, 0.55, 0.5, kit.shirt)
  b.disc({ x: x - cos * 0.75, y: y - sin * 0.75, z: 0.18 }, cam.right, cam.up, 0.13, SKIN, 16)
}

/** Gloves reach out in the direction of the dive. */
function drawGloves(b: Batch, cam: Camera, eid: number, shoulder: number) {
  const x = Position.x[eid]
  const y = Position.y[eid]
  const r = Body.radius[eid]
  const lean = Math.max(-1, Math.min(1, Velocity.y[eid] / 5))
  for (const side of [-1, 1]) {
    const reach = r + 0.15 + Math.max(0, side * lean) * 0.6
    const lift = Math.abs(lean) * 0.5
    const glove = { x: x - 0.1, y: y + side * reach, z: shoulder - 0.1 + lift }
    b.disc(glove, cam.right, cam.up, 0.1, [1, 1, 1, 1], 12)
  }
}

/** An expanding ring on the grass where the last touch was played. */
function drawTouchRing(b: Batch, world: Match) {
  const touch = world.lastTouch
  if (!touch) return
  const t = (world.time - touch.time) / TOUCH_RING_LIFE
  if (t >= 1) return
  const base = touch.style === TouchStyle.Large ? LARGE_TOUCH : SMALL_TOUCH
  const color: Color = [base[0], base[1], base[2], 0.9 * (1 - t)]
  const radius = (touch.style === TouchStyle.Large ? 0.5 : 0.3) + t * 0.6
  b.arc({ x: touch.x, y: touch.y, z: 0.02 }, X, Y, radius, 0.08, 0, Math.PI * 2, color, 32)
}

/**
 * A pass on its way: a faint line from the ball to where it was aimed, and a
 * ring there. A through ball's ring is dashed, to show it's into space.
 */
function drawPass(b: Batch, world: Match) {
  const pass = world.pass
  if (!pass) return
  const ball = world.ball
  b.groundLine(Position.x[ball], Position.y[ball], pass.x, pass.y, 0.05, 0.015, PASS_LINE)
  const segments = pass.kind === 'through' ? 8 : 1
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = a0 + (Math.PI * 2) / segments / (pass.kind === 'through' ? 2 : 1)
    b.arc({ x: pass.x, y: pass.y, z: 0.02 }, X, Y, 0.45, 0.07, a0, a1, PASS_RING, 12)
  }
}

/**
 * Players calling for the ball: a ring at their feet for "here!", and a
 * line to the space they want it played into for "in behind!".
 */
function drawCalls(b: Batch, world: Match) {
  for (const team of world.teams) {
    for (const eid of team.outfielders) {
      const kind = Call.kind[eid]
      if (kind === CallKind.None || eid === world.carrier) continue
      const x = Position.x[eid]
      const y = Position.y[eid]
      b.arc({ x, y, z: 0.02 }, X, Y, 0.75, 0.06, 0, Math.PI * 2, CALL_RING, 24)
      if (kind === CallKind.Space) b.groundLine(x, y, Call.x[eid], Call.y[eid], 0.05, 0.015, CALL_LINE)
    }
  }
}

function drawBall(b: Batch, cam: Camera, eid: number) {
  const p = { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] }
  const height = p.z - BALL_RADIUS
  const r = BALL_RADIUS * cam.ballScale
  b.disc({ x: p.x + SUN.x * height, y: p.y + SUN.y * height, z: 0.015 }, X, Y, r * 0.9, SHADOW, 16)
  // Overhead, a higher ball is closer to the camera; scaling sells the height.
  const drawR = r * (1 + height * 0.12)
  b.disc(p, cam.right, cam.up, drawR, BALL_FILL, 20)
  const behind = { x: p.x + cam.forward.x * 0.05, y: p.y + cam.forward.y * 0.05, z: p.z + cam.forward.z * 0.05 }
  b.disc(behind, cam.right, cam.up, drawR * 1.18, BALL_EDGE, 20)
}

/**
 * The spread circle sits on the plane of the goal being attacked: the goal
 * camera sees it face-on, while overhead it is projected to a wedge from the
 * ball to the goal line.
 */
function drawShotGuide(b: Batch, world: Match) {
  let aim: GoalPoint
  let radius: number
  let origin: Vec3
  let goalX: number
  if (world.shot) {
    ;({ aim, radius, origin, goalX } = world.shot)
  } else {
    if (world.phase !== 'play') return
    const ball = world.ball
    origin = { x: Position.x[ball], y: Position.y[ball], z: Position.z[ball] }
    aim = chooseAim(origin.y, Position.y[world.keeper], world.aimHigh)
    radius = currentSpread(world)
    goalX = attackedGoalX(Team.id[world.carrier])
  }
  const end = Math.sign(goalX)

  const centre = { x: goalX - end * 0.05, y: aim.y, z: aim.z }
  b.disc(centre, Y, Z, radius, AIM_FILL, 40)
  b.arc(centre, Y, Z, radius, 0.05, 0, Math.PI * 2, AIM, 48)
  b.disc({ ...centre, x: centre.x - end * 0.01 }, Y, Z, 0.05, AIM, 10)

  b.tri(
    { x: origin.x, y: origin.y, z: 0.02 },
    { x: goalX, y: aim.y - radius, z: 0.02 },
    { x: goalX, y: aim.y + radius, z: 0.02 },
    AIM_FILL,
  )

  const crossing = world.shot?.crossing
  const outcome = world.event?.kind
  if (crossing && outcome && outcome in SHOT_COLOR) {
    const color = SHOT_COLOR[outcome as ShotOutcome]
    b.disc({ x: goalX - end * 0.1, y: crossing.y, z: crossing.z }, Y, Z, 0.14, color, 16)
    b.disc({ x: goalX, y: crossing.y, z: 0.03 }, X, Y, 0.3, color, 16)
  }
}

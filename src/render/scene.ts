import { frameValue, type Recorder } from '../replay/recorder'
import { roleOf, type Sim } from '../sim/sim'
import type { Color, ShapeRenderer } from './shapes'
import { worldToScreen, type View } from './view'

export const TEAM_COLORS: [Color, Color] = [
  [0.86, 0.2, 0.22, 1],
  [0.2, 0.45, 0.92, 1],
]
const KEEPER_COLORS: [Color, Color] = [
  [0.95, 0.8, 0.15, 1],
  [0.25, 0.8, 0.45, 1],
]
const OUTLINE: Color = [0.05, 0.05, 0.05, 0.85]
const BALL: Color = [1, 1, 1, 1]
const SHADOW: Color = [0, 0, 0, 0.35]
const SELECTED: Color = [1, 1, 0.3, 1]
/** Drawn larger than life so players read at full-pitch zoom. */
export const PLAYER_DRAW_RADIUS = 0.8

/** Where to draw an entity: x, y, z, facing. Returns a shared array; copy to keep. */
export type Pose = (eid: number) => readonly [number, number, number, number]

const out: [number, number, number, number] = [0, 0, 0, 0]

/** The live sim, interpolated between the previous and current tick. */
export function livePose(sim: Sim, prev: Float64Array, alpha: number): Pose {
  const { Pos, Air, Facing } = sim.c
  return (eid) => {
    const o = eid * 3
    out[0] = prev[o] + (Pos.x[eid] - prev[o]) * alpha
    out[1] = prev[o + 1] + (Pos.y[eid] - prev[o + 1]) * alpha
    out[2] = prev[o + 2] + (Air.z[eid] - prev[o + 2]) * alpha
    out[3] = Facing.a[eid]
    return out
  }
}

/** A recorded frame. */
export function framePose(rec: Recorder, tick: number): Pose {
  const frame = rec.frame(tick)
  return (eid) => {
    const i = rec.entities.indexOf(eid)
    out[0] = frameValue(frame, i, 'x')
    out[1] = frameValue(frame, i, 'y')
    out[2] = frameValue(frame, i, 'z')
    out[3] = frameValue(frame, i, 'facing')
    return out
  }
}

export function drawScene(r: ShapeRenderer, sim: Sim, pose: Pose, selected: readonly number[]): void {
  const { Player } = sim.c
  for (const eid of sim.players) {
    const [x, y, , a] = pose(eid)
    const team = Player.team[eid]
    const color = roleOf(sim, eid) === 'GK' ? KEEPER_COLORS[team] : TEAM_COLORS[team]
    if (selected.includes(eid)) r.ring(x, y, PLAYER_DRAW_RADIUS + 0.45, 0.25, SELECTED)
    r.disc(x, y, PLAYER_DRAW_RADIUS, OUTLINE)
    r.disc(x, y, PLAYER_DRAW_RADIUS - 0.12, color)
    r.line(x, y, x + Math.cos(a) * 1.25, y + Math.sin(a) * 1.25, 0.16, OUTLINE)
  }
  const [bx, by, bz] = pose(sim.ball)
  const lift = bz * 0.6
  r.disc(bx + lift * 0.4, by - lift * 0.4, 0.32, SHADOW)
  r.disc(bx, by + lift, 0.36 + bz * 0.05, OUTLINE)
  r.disc(bx, by + lift, 0.3 + bz * 0.05, BALL)
}

/** Shirt numbers, drawn on a 2D canvas laid over the WebGL one. */
export function drawLabels(ctx: CanvasRenderingContext2D, view: View, sim: Sim, pose: Pose) {
  ctx.clearRect(0, 0, view.width, view.height)
  const size = Math.max(9, PLAYER_DRAW_RADIUS * view.scale * 1.05)
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'
  for (const eid of sim.players) {
    const [x, y] = pose(eid)
    const [sx, sy] = worldToScreen(view, x, y)
    ctx.fillText(String(sim.c.Player.number[eid]), sx, sy + size * 0.05)
  }
}

/** The player drawn under a world point, or -1. */
export function pick(sim: Sim, pose: Pose, x: number, y: number): number {
  let best = -1
  let bestD = (PLAYER_DRAW_RADIUS + 0.6) * (PLAYER_DRAW_RADIUS + 0.6)
  for (const eid of sim.players) {
    const [px, py] = pose(eid)
    const d = (px - x) * (px - x) + (py - y) * (py - y)
    if (d < bestD) {
      best = eid
      bestD = d
    }
  }
  return best
}

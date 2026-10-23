import * as P from '../sim/pitch'
import type { Color, ShapeRenderer } from './shapes'

const GRASS_DARK: Color = [0.16, 0.42, 0.2, 1]
const GRASS_LIGHT: Color = [0.18, 0.46, 0.22, 1]
const LINE: Color = [0.92, 0.95, 0.92, 0.9]
const GOAL: Color = [0.95, 0.95, 0.95, 1]
const LW = 0.12
const STRIPES = 14

export const SURROUND: Color = [0.11, 0.3, 0.15, 1]

export function drawPitch(r: ShapeRenderer): void {
  const L = P.HALF_LENGTH
  const W = P.HALF_WIDTH
  const stripe = P.PITCH_LENGTH / STRIPES
  for (let i = 0; i < STRIPES; i++) {
    r.rect(-L + stripe * (i + 0.5), 0, stripe, P.PITCH_WIDTH, i % 2 ? GRASS_LIGHT : GRASS_DARK)
  }

  r.line(-L, -W, L, -W, LW, LINE)
  r.line(-L, W, L, W, LW, LINE)
  r.line(-L, -W, -L, W, LW, LINE)
  r.line(L, -W, L, W, LW, LINE)
  r.line(0, -W, 0, W, LW, LINE)
  r.ring(0, 0, P.CENTRE_CIRCLE_RADIUS + LW / 2, LW, LINE)
  r.disc(0, 0, 0.25, LINE)

  for (const side of [-1, 1]) {
    const gx = side * L
    box(r, gx, P.PENALTY_AREA_DEPTH * -side, P.PENALTY_AREA_WIDTH)
    box(r, gx, P.GOAL_AREA_DEPTH * -side, P.GOAL_AREA_WIDTH)
    const spot = gx - side * P.PENALTY_SPOT_DISTANCE
    r.disc(spot, 0, 0.2, LINE)
    // The penalty arc is the part of the 9.15 m circle round the spot outside the area.
    const edge = P.PENALTY_AREA_DEPTH - P.PENALTY_SPOT_DISTANCE
    const half = Math.acos(edge / P.CENTRE_CIRCLE_RADIUS)
    const facing = side > 0 ? Math.PI : 0
    r.arc(spot, 0, P.CENTRE_CIRCLE_RADIUS, facing - half, facing + half, LW, LINE, 16)
    for (const cy of [-W, W]) {
      const a0 = side > 0 ? Math.PI : 0
      const sweep = (cy > 0 ? -1 : 1) * (side > 0 ? -1 : 1) * (Math.PI / 2)
      r.arc(gx, cy, P.CORNER_ARC_RADIUS, a0, a0 + sweep, LW, LINE, 6)
    }
    const back = gx + side * P.GOAL_DEPTH
    const gw = P.GOAL_WIDTH / 2
    r.line(gx, -gw, back, -gw, 0.12, GOAL)
    r.line(gx, gw, back, gw, 0.12, GOAL)
    r.line(back, -gw, back, gw, 0.12, GOAL)
    r.disc(gx, -gw, 0.12, GOAL)
    r.disc(gx, gw, 0.12, GOAL)
  }
}

function box(r: ShapeRenderer, goalX: number, depth: number, width: number) {
  const hw = width / 2
  const fx = goalX + depth
  r.line(goalX, -hw, fx, -hw, LW, LINE)
  r.line(goalX, hw, fx, hw, LW, LINE)
  r.line(fx, -hw, fx, hw, LW, LINE)
}

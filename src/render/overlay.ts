import type { Match } from '../sim/match'
import { controlAt } from '../sim/space/control'
import { threat } from '../sim/space/threat'
import type { Batch, Color } from './batch'

/** What the debug overlay shows: nothing, the threat map, or who controls each part of the pitch. */
export type Overlay = 'off' | 'threat' | 'control'

/** Cell size (m) of the overlay grid. */
const CELL = 2
const HALF = { x: CELL / 2, y: 0, z: 0 }
const HALF_Y = { x: 0, y: CELL / 2, z: 0 }
/** Team colours for the control map, by team id. */
const TEAM_TINT: readonly [number, number, number][] = [
  [0.95, 0.25, 0.25],
  [0.3, 0.5, 1],
]

/**
 * Paints the space model over the pitch, from the point of view of the team
 * on the ball. Threat shades from clear to hot. Control tints each cell with
 * the colour of the team that would get there first, more strongly the surer
 * that is.
 */
export function drawOverlay(b: Batch, world: Match, overlay: Overlay) {
  if (overlay === 'off') return
  const team = world.possession
  const { halfLength: L, halfWidth: W } = world.pitch
  for (let x = -L + CELL / 2; x < L; x += CELL) {
    for (let y = -W + CELL / 2; y < W; y += CELL) {
      let color: Color
      if (overlay === 'threat') {
        const t = Math.min(1, threat(world.pitch, team, x, y) / 0.6)
        color = [1, 0.9 - 0.7 * t, 0.2, 0.55 * t]
      } else {
        const p = controlAt(world, team, x, y)
        const [r, g, bl] = TEAM_TINT[p >= 0.5 ? team : 1 - team]
        color = [r, g, bl, Math.abs(p - 0.5) * 0.9]
      }
      b.quad({ x, y, z: 0.005 }, HALF, HALF_Y, color)
    }
  }
}

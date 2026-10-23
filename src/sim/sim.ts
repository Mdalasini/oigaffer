import { addComponent, addEntity, createWorld, type World } from 'bitecs'
import { createComponents, type Components } from './components'
import { FORMATIONS, type Formation, type Role } from './formation'
import { clamp } from './fmath'
import { createScratch, type Scratch } from './scratch'
import { createMatchState, type MatchConfig, type MatchState } from './state'
import { next, type Rng } from './rng'

export interface Sim {
  world: World
  c: Components
  m: MatchState
  cfg: MatchConfig
  ball: number
  /** All 22 players, home team first, each team in formation-slot order. */
  players: number[]
  teams: [number[], number[]]
  formations: [Formation, Formation]
  /** Per-tick derived caches. Not part of a snapshot; rebuilt every tick. */
  scratch: Scratch
}

export const DEFAULT_CONFIG: MatchConfig = { seed: 1, halfMinutes: 45, formations: ['4-3-3', '3-4-3'] }

export function createSim(cfg: MatchConfig = DEFAULT_CONFIG): Sim {
  const world = createWorld()
  const c = createComponents()
  const m = createMatchState(cfg)
  const formations: [Formation, Formation] = [FORMATIONS[cfg.formations[0]], FORMATIONS[cfg.formations[1]]]

  const ball = addEntity(world)
  addComponent(world, ball, c.Pos)
  addComponent(world, ball, c.Vel)
  addComponent(world, ball, c.Air)

  const teams: [number[], number[]] = [[], []]
  for (const team of [0, 1]) {
    formations[team].slots.forEach((slot, i) => {
      const eid = addEntity(world)
      for (const comp of [c.Pos, c.Vel, c.Facing, c.Player, c.Attr, c.Motor, c.Intent, c.Brain]) {
        addComponent(world, eid, comp)
      }
      c.Player.team[eid] = team
      c.Player.slot[eid] = i
      c.Player.number[eid] = slot.number
      rollAttributes(c, eid, slot.role, m.rng)
      // Stagger decisions so the 22 brains do not all think on the same tick.
      c.Brain.nextThink[eid] = teams[team].length
      c.Brain.noTouchUntil[eid] = -1
      c.Brain.lastTouch[eid] = -1
      teams[team].push(eid)
    })
  }

  return {
    world,
    c,
    m,
    cfg,
    ball,
    players: [...teams[0], ...teams[1]],
    teams,
    formations,
    scratch: createScratch(),
  }
}

const KEY_ATTRS: Record<Role, (keyof Components['Attr'])[]> = {
  GK: ['keeping', 'reactions', 'positioning'],
  CB: ['strength', 'tackling', 'positioning'],
  FB: ['pace', 'tackling', 'accel'],
  WB: ['pace', 'accel', 'passing'],
  DM: ['tackling', 'passing', 'positioning'],
  CM: ['passing', 'vision', 'firstTouch'],
  W: ['pace', 'dribbling', 'agility'],
  ST: ['shooting', 'composure', 'firstTouch'],
}

function rollAttributes(c: Components, eid: number, role: Role, rng: Rng) {
  for (const key of Object.keys(c.Attr) as (keyof Components['Attr'])[]) {
    c.Attr[key][eid] = 0.45 + 0.25 * next(rng)
  }
  for (const key of KEY_ATTRS[role]) c.Attr[key][eid] = clamp(c.Attr[key][eid] + 0.2, 0, 0.95)
  if (role !== 'GK') c.Attr.keeping[eid] = 0.1
  else c.Attr.pace[eid] = clamp(c.Attr.pace[eid] - 0.15, 0.2, 1)
}

export function teamOf(sim: Sim, eid: number): number {
  return sim.c.Player.team[eid]
}

export function roleOf(sim: Sim, eid: number): Role {
  const { team, slot } = sim.c.Player
  return sim.formations[team[eid]].slots[slot[eid]].role
}

/** +1 if the team attacks towards +x this half, else -1. */
export function attackDir(sim: Sim, team: number): number {
  const firstHalfDir = team === 0 ? 1 : -1
  return sim.m.half === 1 ? firstHalfDir : -firstHalfDir
}

/** Short stable name for logs and flags, e.g. "H9" or "A4". */
export function label(sim: Sim, eid: number): string {
  if (eid === sim.ball) return 'ball'
  if (eid < 0) return '-'
  return (teamOf(sim, eid) === 0 ? 'H' : 'A') + sim.c.Player.number[eid]
}

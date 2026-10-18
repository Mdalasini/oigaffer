import type { Pitch } from './pitch'

export const TEAM_NAMES = ['red', 'blue'] as const
export type TeamName = (typeof TEAM_NAMES)[number]

/** +1 for the team attacking the goal at +x, -1 for the one attacking -x. */
export const attackDir = (team: number) => (team === 0 ? 1 : -1)
/** The x of the goal line `team` attacks. */
export const attackedGoalX = (pitch: Pitch, team: number) => attackDir(team) * pitch.halfLength
/** The x of the goal line `team` defends. */
export const ownGoalX = (pitch: Pitch, team: number) => -attackedGoalX(pitch, team)
export const opponent = (team: number) => 1 - team

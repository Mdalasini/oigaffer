import { GOAL_X } from './constants'

export const TEAM_NAMES = ['red', 'blue'] as const
export type TeamName = (typeof TEAM_NAMES)[number]

/** +1 for the team attacking the goal at +x, -1 for the one attacking -x. */
export const attackDir = (team: number) => (team === 0 ? 1 : -1)
/** The x of the goal line `team` attacks. */
export const attackedGoalX = (team: number) => attackDir(team) * GOAL_X
/** The x of the goal line `team` defends. */
export const ownGoalX = (team: number) => -attackedGoalX(team)
export const opponent = (team: number) => 1 - team

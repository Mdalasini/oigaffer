// Formations. Positions are in the team's attacking frame (metres, +x towards
// the opponent's goal, +y to the team's left) for a ball on the centre spot.
// `attack` is the shape in possession, `defend` the shape out of it.

export type Role = 'GK' | 'CB' | 'FB' | 'WB' | 'DM' | 'CM' | 'W' | 'ST'

export interface Slot {
  name: string
  role: Role
  number: number
  attack: readonly [number, number]
  defend: readonly [number, number]
}

export interface Formation {
  name: string
  slots: readonly Slot[]
}

const GK: Slot = { name: 'GK', role: 'GK', number: 1, attack: [-48, 0], defend: [-48, 0] }

export const F433: Formation = {
  name: '4-3-3',
  slots: [
    GK,
    { name: 'RB', role: 'FB', number: 2, attack: [-15, -28], defend: [-30, -20] },
    { name: 'RCB', role: 'CB', number: 4, attack: [-28, -9], defend: [-32, -7] },
    { name: 'LCB', role: 'CB', number: 5, attack: [-28, 9], defend: [-32, 7] },
    { name: 'LB', role: 'FB', number: 3, attack: [-15, 28], defend: [-30, 20] },
    { name: 'DM', role: 'DM', number: 6, attack: [-16, 0], defend: [-22, 0] },
    { name: 'RCM', role: 'CM', number: 8, attack: [-4, -13], defend: [-14, -10] },
    { name: 'LCM', role: 'CM', number: 10, attack: [-4, 13], defend: [-14, 10] },
    { name: 'RW', role: 'W', number: 7, attack: [14, -27], defend: [-4, -22] },
    { name: 'ST', role: 'ST', number: 9, attack: [18, 0], defend: [2, 0] },
    { name: 'LW', role: 'W', number: 11, attack: [14, 27], defend: [-4, 22] },
  ],
}

export const F343: Formation = {
  name: '3-4-3',
  slots: [
    GK,
    { name: 'RCB', role: 'CB', number: 2, attack: [-26, -16], defend: [-33, -13] },
    { name: 'CB', role: 'CB', number: 4, attack: [-30, 0], defend: [-35, 0] },
    { name: 'LCB', role: 'CB', number: 5, attack: [-26, 16], defend: [-33, 13] },
    { name: 'RWB', role: 'WB', number: 3, attack: [-2, -29], defend: [-28, -26] },
    { name: 'RCM', role: 'CM', number: 6, attack: [-10, -7], defend: [-18, -7] },
    { name: 'LCM', role: 'CM', number: 8, attack: [-10, 7], defend: [-18, 7] },
    { name: 'LWB', role: 'WB', number: 12, attack: [-2, 29], defend: [-28, 26] },
    { name: 'RW', role: 'W', number: 7, attack: [12, -14], defend: [-6, -14] },
    { name: 'ST', role: 'ST', number: 9, attack: [18, 0], defend: [2, 0] },
    { name: 'LW', role: 'W', number: 11, attack: [12, 14], defend: [-6, 14] },
  ],
}

export const FORMATIONS: Record<string, Formation> = { '4-3-3': F433, '3-4-3': F343 }

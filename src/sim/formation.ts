/**
 * Where a player sits in their team's block: `depth` from its back edge (0)
 * to its front edge (1), and `width` from one side (-1, the -y side for the
 * team attacking +x) to the other (+1).
 */
export interface SlotDef {
  depth: number
  width: number
}

/** A team's shape with the ball and without it, one slot per outfielder. */
export interface Formation {
  name: string
  inPossession: SlotDef[]
  outOfPossession: SlotDef[]
}

/**
 * Two outfielders: with the ball, one stays deep to support and protect
 * against the counter while the other plays on the last line, on a diagonal
 * from them rather than square. Without it they defend one behind the other.
 */
const ONE_ONE: Formation = {
  name: '1-1',
  inPossession: [
    { depth: 0.1, width: -0.35 },
    { depth: 1, width: 0.35 },
  ],
  outOfPossession: [
    { depth: 0, width: -0.2 },
    { depth: 0.6, width: 0.2 },
  ],
}

/** A lone outfielder plays in the middle of the block. */
const ONE: Formation = {
  name: '1',
  inPossession: [{ depth: 0.5, width: 0 }],
  outOfPossession: [{ depth: 0.5, width: 0 }],
}

/**
 * Four outfielders, the classic five-a-side shape. With the ball, a diamond:
 * a base player at the back to recycle it and guard the counter, two wide
 * to stretch the block and give the angles of a triangle, and a pivot up on
 * the last line to pin the defenders and give depth. Without it, a 2-2 box:
 * two at the back protect the centre, two in front screen it, and the box
 * slides over to the ball as one. Each player's two slots are near each
 * other, so the change of shape on a turnover is a few steps for everyone:
 * the base and the right-sided player drop into the back two, the left and
 * the pivot screen in front.
 */
const DIAMOND: Formation = {
  name: '1-2-1',
  inPossession: [
    { depth: 0, width: 0 },
    { depth: 0.45, width: -0.9 },
    { depth: 0.45, width: 0.9 },
    { depth: 1, width: 0 },
  ],
  outOfPossession: [
    { depth: 0, width: -0.4 },
    { depth: 0.6, width: -0.45 },
    { depth: 0, width: 0.4 },
    { depth: 0.6, width: 0.45 },
  ],
}

/**
 * Ten outfielders, a 4-3-3. With the ball, the two centre-backs split and
 * stay back with the holding midfielder in front of them, the full-backs push
 * on to give width, the two eights take the half-spaces, and the wingers and
 * centre-forward pin the back line. Without it, a 4-1-4-1: a flat back four,
 * the holder screening it, a line of four in front, and the centre-forward
 * leading the press. As in the diamond, each player's two places are close.
 */
const FOUR_THREE_THREE: Formation = {
  name: '4-3-3',
  inPossession: [
    { depth: 0, width: -0.3 },
    { depth: 0, width: 0.3 },
    { depth: 0.4, width: -0.95 },
    { depth: 0.4, width: 0.95 },
    { depth: 0.25, width: 0 },
    { depth: 0.6, width: -0.4 },
    { depth: 0.6, width: 0.4 },
    { depth: 0.95, width: -0.8 },
    { depth: 0.95, width: 0.8 },
    { depth: 1, width: 0 },
  ],
  outOfPossession: [
    { depth: 0, width: -0.25 },
    { depth: 0, width: 0.25 },
    { depth: 0, width: -0.75 },
    { depth: 0, width: 0.75 },
    { depth: 0.3, width: 0 },
    { depth: 0.55, width: -0.3 },
    { depth: 0.55, width: 0.3 },
    { depth: 0.6, width: -0.85 },
    { depth: 0.6, width: 0.85 },
    { depth: 1, width: 0 },
  ],
}

/**
 * Ten outfielders, a 3-4-3. With the ball, three centre-backs spread across
 * the back, two central midfielders sit in front of them, the wing-backs push
 * on to hold the width on their own, so the two wide forwards can come
 * inside to the half-spaces either side of the centre-forward. Without it, a
 * 5-4-1: the wing-backs drop in beside the centre-backs to make a back five,
 * the wide forwards drop in beside the two midfielders, and the
 * centre-forward leads the press. Slots are numbered back to front, as in the
 * 4-3-3.
 */
const THREE_FOUR_THREE: Formation = {
  name: '3-4-3',
  inPossession: [
    { depth: 0, width: -0.55 },
    { depth: 0, width: 0 },
    { depth: 0, width: 0.55 },
    { depth: 0.55, width: -0.95 },
    { depth: 0.55, width: 0.95 },
    { depth: 0.3, width: -0.25 },
    { depth: 0.3, width: 0.25 },
    { depth: 0.95, width: -0.45 },
    { depth: 0.95, width: 0.45 },
    { depth: 1, width: 0 },
  ],
  outOfPossession: [
    { depth: 0, width: -0.4 },
    { depth: 0, width: 0 },
    { depth: 0, width: 0.4 },
    { depth: 0, width: -0.85 },
    { depth: 0, width: 0.85 },
    { depth: 0.5, width: -0.25 },
    { depth: 0.5, width: 0.25 },
    { depth: 0.55, width: -0.75 },
    { depth: 0.55, width: 0.75 },
    { depth: 1, width: 0 },
  ],
}

/** Every formation, by name, for sides of any size. */
export const FORMATIONS = {
  '1': ONE,
  '1-1': ONE_ONE,
  '1-2-1': DIAMOND,
  '4-3-3': FOUR_THREE_THREE,
  '3-4-3': THREE_FOUR_THREE,
} as const
export type FormationName = keyof typeof FORMATIONS

/** The formations Red and Blue line up in, in that order, with `outfielders` a side unless a match asks otherwise. */
export function defaultFormations(outfielders: number): [FormationName, FormationName] {
  if (outfielders === 1) return ['1', '1']
  if (outfielders === 2) return ['1-1', '1-1']
  if (outfielders === 4) return ['1-2-1', '1-2-1']
  if (outfielders === 10) return ['4-3-3', '3-4-3']
  throw new Error(`no formation for ${outfielders} outfielders`)
}

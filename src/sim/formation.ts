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

/** The formation for a side of `outfielders`. */
export function formationFor(outfielders: number): Formation {
  if (outfielders === 1) return ONE
  if (outfielders === 2) return ONE_ONE
  if (outfielders === 4) return DIAMOND
  throw new Error(`no formation for ${outfielders} outfielders`)
}

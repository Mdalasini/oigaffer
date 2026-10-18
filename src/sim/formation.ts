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

/** The formation for a side of `outfielders`. */
export function formationFor(outfielders: number): Formation {
  if (outfielders === 1) return ONE
  if (outfielders === 2) return ONE_ONE
  throw new Error(`no formation for ${outfielders} outfielders`)
}

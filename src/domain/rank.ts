/** Spacing between neighbours when appending or rebalancing. */
export const RANK_STEP = 1024

/**
 * A rank strictly between two neighbours (either may be missing), so moving
 * one card rewrites one document instead of the whole column.
 */
export function rankBetween(before: number | null | undefined, after: number | null | undefined): number {
  const hasBefore = typeof before === 'number' && Number.isFinite(before)
  const hasAfter = typeof after === 'number' && Number.isFinite(after)
  if (hasBefore && hasAfter) return (before! + after!) / 2
  if (hasBefore) return before! + RANK_STEP
  if (hasAfter) return after! - RANK_STEP
  return RANK_STEP
}

/** True when two neighbours are too close for another midpoint. */
export const needsRebalance = (before: number, after: number) => Math.abs(after - before) < 1e-6

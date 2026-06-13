import type { Cefr, Profile } from '../db/types'

// CEFR / claimed-level ranking, shared by the session composer and vocabulary queries.

export const LEVEL_RANK: Record<Profile['claimedLevel'], number> = {
  'below-A1': 0,
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
  C2: 6,
}

export function levelRank(level: Profile['claimedLevel']): number {
  return LEVEL_RANK[level]
}

/**
 * Rank of an entry's CEFR. No CEFR (user entries) → Infinity, so the "cefr <= level+1"
 * progression rule never pulls them in; their eligibility comes from source / study.
 */
export function cefrRank(cefr?: Cefr): number {
  return cefr ? LEVEL_RANK[cefr] : Number.POSITIVE_INFINITY
}

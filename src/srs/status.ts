import type { ReviewState } from '../db/types'

// Per-word study status — the four states surfaced as coloured icons in Vocabulary / Word Detail and
// as the progress-bar segments in Profile. (SPEC §7.3) A pure classifier: kept in the srs layer (not
// db/queries) so both the queries and the level-progress helper can share it without a circular import.

export type Status = 'none' | 'struggling' | 'learning' | 'solid'

/** Map an FSRS ReviewState to a status, by `stability` (in days). Thresholds per SPEC §7.3. */
export function deriveStatus(rs?: ReviewState): Status {
  if (!rs) return 'none'
  if (rs.lapses >= 3 && rs.stability < 7) return 'struggling'
  if (rs.stability < 30) return 'learning'
  return 'solid'
}

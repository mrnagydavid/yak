import type { Cefr, Entry, Profile, ReviewState, Translation } from '../db/types'
import { cefrRank, levelRank, nextLevel } from './levels'
import { deriveStatus, type Status } from './status'

// "Level up" detection (design turn): when the learner has cleared the band their daily new words come
// from — the CEFR one step above their claimed level — offer to move them up so a fresh band opens.
//
// WHAT "CLEARED" MEANS. The new-word band is exactly the seed words at `cefr === level+1` (the composer's
// `bandOf` returns 'new' for those; at/below level is 'calibration'). A word counts as cleared when its
// RECOGNITION has graduated to FSRS `review` state — not merely introduced (which would be `learning` or
// `relearning`), and not the higher "solid" bar Vocabulary uses (30-day stability), which almost never
// all-clears. Recognition is the per-word skill (carried by the primary meaning); production trickles in
// far later and lags for multi-meaning words, so requiring it would make the prompt near-unreachable.

export type ClaimedLevel = Profile['claimedLevel']

export interface ClearedLevelInput {
  level: ClaimedLevel
  entries: Entry[]
  translations: Translation[]
  reviewStates: ReviewState[]
}

/**
 * The level to promote the learner to, or null. Non-null iff there IS a band above the claimed level and
 * every eligible seed word in it (cefr === level+1, not `study: 'skip'`) has its recognition in `review`
 * state. Returns null at the ceiling (C2) or when that band is empty — nothing to clear.
 */
export function clearedNextLevel(input: ClearedLevelInput): ClaimedLevel | null {
  const target = nextLevel(input.level)
  if (!target) return null // already at C2 — no band above
  const targetRank = levelRank(target) // === levelRank(level) + 1

  // Recognition is per word, carried by the primary meaning's link (multi-meaning design).
  const primaryByEntry = new Map<string, Translation>()
  for (const t of input.translations) if (t.primary) primaryByEntry.set(t.targetEntryId, t)

  const recByTranslation = new Map<string, ReviewState>()
  for (const rs of input.reviewStates) if (rs.skill === 'recognize') recByTranslation.set(rs.translationId, rs)

  // The new-word band: eligible seed words exactly one CEFR step above the claim.
  const band = input.entries.filter(
    (e) => e.source === 'seed' && e.study !== 'skip' && cefrRank(e.cefr) === targetRank,
  )
  if (band.length === 0) return null // no words to clear (empty band / no seed at that level)

  const allGraduated = band.every((e) => {
    const primary = primaryByEntry.get(e.id)
    const rec = primary ? recByTranslation.get(primary.id) : undefined
    return rec?.state === 'review'
  })
  return allGraduated ? target : null
}

// ---- per-level progress breakdown (Profile progress bars) ----

const CEFR_LEVELS: Cefr[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

/** One CEFR band's word counts, split by study status (the `deriveStatus` buckets Vocabulary uses). */
export interface LevelProgressRow {
  level: Cefr
  total: number
  counts: Record<Status, number>
}

/**
 * Bucket a language's seed words by CEFR level × recognition status, for the Profile progress bars.
 * Status is per WORD, read off the primary meaning's recognition (the per-word skill), classified with
 * the same `deriveStatus` thresholds Vocabulary/Word Detail use — so a word's colour agrees everywhere.
 * `study: 'skip'` words and user words (no CEFR) are excluded, matching what's actually being learned.
 */
export function levelBreakdown(input: {
  entries: Entry[]
  translations: Translation[]
  reviewStates: ReviewState[]
}): LevelProgressRow[] {
  const primaryByEntry = new Map<string, Translation>()
  for (const t of input.translations) if (t.primary) primaryByEntry.set(t.targetEntryId, t)

  const recByTranslation = new Map<string, ReviewState>()
  for (const rs of input.reviewStates) if (rs.skill === 'recognize') recByTranslation.set(rs.translationId, rs)

  const rows: LevelProgressRow[] = CEFR_LEVELS.map((level) => ({
    level,
    total: 0,
    counts: { none: 0, struggling: 0, learning: 0, solid: 0 },
  }))
  const rowByLevel = new Map(rows.map((r) => [r.level, r]))

  for (const e of input.entries) {
    if (e.source !== 'seed' || e.study === 'skip' || !e.cefr) continue
    const row = rowByLevel.get(e.cefr)
    if (!row) continue
    const primary = primaryByEntry.get(e.id)
    const rec = primary ? recByTranslation.get(primary.id) : undefined
    row.counts[deriveStatus(rec)] += 1
    row.total += 1
  }
  return rows
}

/** A per-target, per-day "not now" so a dismissed prompt doesn't re-pop the same day (it re-asks the
 *  next day, since the band stays cleared). Stored in the `meta` table as JSON. */
export interface PromotionSnooze {
  level: ClaimedLevel
  day: string // session-store dayKey (local calendar day)
}

/** Whether a pending promotion to `target` is currently snoozed (same target, same day). */
export function promotionSnoozed(
  snooze: PromotionSnooze | null | undefined,
  target: ClaimedLevel,
  today: string,
): boolean {
  return !!snooze && snooze.level === target && snooze.day === today
}

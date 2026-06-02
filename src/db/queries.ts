import { db } from './schema'
import type { Entry, EntryOverlay, ReviewState, Skill } from './types'

/** The four study states surfaced as coloured icons in Vocabulary / Word Detail. (SPEC §7.3) */
export type Status = 'none' | 'struggling' | 'learning' | 'solid'

/** Map an FSRS ReviewState to a status, by `stability` (in days). Thresholds per SPEC §7.3. */
export function deriveStatus(rs?: ReviewState): Status {
  if (!rs) return 'none'
  if (rs.lapses >= 3 && rs.stability < 7) return 'struggling'
  if (rs.stability < 30) return 'learning'
  return 'solid'
}

export async function getActiveProfile() {
  // `active` is indexed, but only `true` rows resolve to a valid key (booleans aren't
  // indexed when false/undefined), so equals(1) won't work — query the truthy side.
  return db.profiles.filter((p) => p.active).first()
}

export function getEntry(id: string) {
  return db.entries.get(id)
}

export function getOverlay(entryId: string): Promise<EntryOverlay | undefined> {
  return db.entryOverlays.where('entryId').equals(entryId).first()
}

export function getReviewState(translationId: string, skill: Skill) {
  return db.reviewStates.where('[translationId+skill]').equals([translationId, skill]).first()
}

/** A single row in the Vocabulary list: an entry plus its primary translation and per-skill status. */
export interface VocabRow {
  entry: Entry
  native?: string
  recognize: Status
  produce: Status
}

/**
 * Build the Vocabulary list for a target language: each target entry with its primary
 * native translation and per-skill status. Bulk-loads to avoid N+1 queries.
 *
 * Minimal Step 1 version: uses each entry's first translation. The full filtered /
 * virtualised browser (SPEC §7.3) comes in a later turn.
 */
export async function listVocabulary(targetLang: string): Promise<VocabRow[]> {
  const entries = await db.entries.where('lang').equals(targetLang).sortBy('lemma')
  if (entries.length === 0) return []

  const entryIds = entries.map((e) => e.id)
  const translations = await db.translations.where('targetEntryId').anyOf(entryIds).toArray()

  const nativeIds = [...new Set(translations.map((t) => t.nativeEntryId))]
  const nativeEntries = await db.entries.bulkGet(nativeIds)
  const nativeById = new Map(nativeEntries.filter(Boolean).map((e) => [e!.id, e!]))

  const translationIds = translations.map((t) => t.id)
  const reviewStates = await db.reviewStates.where('translationId').anyOf(translationIds).toArray()

  // First translation per target entry, and its review states keyed by skill.
  const firstTranslationByEntry = new Map<string, string>() // entryId -> translationId
  for (const t of translations) {
    if (!firstTranslationByEntry.has(t.targetEntryId)) {
      firstTranslationByEntry.set(t.targetEntryId, t.id)
    }
  }
  const rsByTranslationSkill = new Map<string, ReviewState>() // `${translationId}:${skill}` -> rs
  for (const rs of reviewStates) {
    rsByTranslationSkill.set(`${rs.translationId}:${rs.skill}`, rs)
  }

  return entries.map((entry) => {
    const translationId = firstTranslationByEntry.get(entry.id)
    const translation = translations.find((t) => t.id === translationId)
    const native = translation ? nativeById.get(translation.nativeEntryId)?.lemma : undefined
    return {
      entry,
      native,
      recognize: deriveStatus(translationId ? rsByTranslationSkill.get(`${translationId}:recognize`) : undefined),
      produce: deriveStatus(translationId ? rsByTranslationSkill.get(`${translationId}:produce`) : undefined),
    }
  })
}

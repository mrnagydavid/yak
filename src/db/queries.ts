import { db } from './schema'
import { cefrRank, levelRank } from '../srs/levels'
import type { SessionCard } from '../srs/session-composer'
import type { Entry, EntryOverlay, Profile, ReviewState, Skill, Translation } from './types'

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

/** Everything the Practice card needs to render: the session card plus resolved entities. */
export interface PracticeCardView {
  card: SessionCard
  target: Entry
  native?: Entry
  overlay?: EntryOverlay
}

/** Resolve a session card's display data. Returns null if the target entry is missing. */
export async function getPracticeCardView(card: SessionCard): Promise<PracticeCardView | null> {
  const target = await db.entries.get(card.targetEntryId)
  if (!target) return null
  const translation = await db.translations.get(card.translationId)
  const native = translation ? await db.entries.get(translation.nativeEntryId) : undefined
  const overlay = await getOverlay(target.id)
  return { card, target, native, overlay }
}

/** A single row in the Vocabulary list. (SPEC §7.3) */
export interface VocabRow {
  entry: Entry
  native?: string // primary translation lemma
  note?: string // overlay note text — searchable
  inStudySet: boolean // ★ marker
  recognize: Status
  produce: Status
  lastPracticed?: number // most recent lastReview across the entry's skills — for sorting
  lapses: number // highest lapse count across the entry's skills — for "hardest" sort
}

/** Study-set membership per SPEC §6.1. */
function isInStudySet(entry: Entry, level: Profile['claimedLevel'], hasSrs: boolean): boolean {
  return (
    entry.source === 'user' ||
    entry.userFlagged === true ||
    hasSrs ||
    (entry.source === 'seed' && cefrRank(entry.cefr) <= levelRank(level) + 1)
  )
}

/**
 * Build the Vocabulary list for a target language: each target entry with its primary
 * native translation, per-skill status, study-set membership, and sort keys. Bulk-loads
 * to avoid N+1 queries; search/filter/sort happen in the screen.
 *
 * Loads the whole language into memory — fine for now; the seed-scale (8k) path will need
 * indexed queries + virtualisation (SPEC §7.3), deferred.
 */
export async function listVocabulary(
  targetLang: string,
  level: Profile['claimedLevel'],
): Promise<VocabRow[]> {
  const entries = await db.entries.where('lang').equals(targetLang).sortBy('lemma')
  if (entries.length === 0) return []

  const entryIds = entries.map((e) => e.id)
  const translations = await db.translations.where('targetEntryId').anyOf(entryIds).toArray()

  const nativeIds = [...new Set(translations.map((t) => t.nativeEntryId))]
  const nativeEntries = await db.entries.bulkGet(nativeIds)
  const nativeById = new Map(nativeEntries.filter(Boolean).map((e) => [e!.id, e!]))

  const translationIds = translations.map((t) => t.id)
  const reviewStates = await db.reviewStates.where('translationId').anyOf(translationIds).toArray()
  const overlays = await db.entryOverlays.toArray()
  const noteByEntry = new Map(overlays.map((o) => [o.entryId, o.noteText]))

  // Translations grouped per target entry; review states keyed by translation+skill.
  const translationsByEntry = new Map<string, Translation[]>()
  for (const t of translations) {
    const list = translationsByEntry.get(t.targetEntryId)
    if (list) list.push(t)
    else translationsByEntry.set(t.targetEntryId, [t])
  }
  const rsByKey = new Map<string, ReviewState>()
  const rsByTranslation = new Map<string, ReviewState[]>()
  for (const rs of reviewStates) {
    rsByKey.set(`${rs.translationId}:${rs.skill}`, rs)
    const list = rsByTranslation.get(rs.translationId)
    if (list) list.push(rs)
    else rsByTranslation.set(rs.translationId, [rs])
  }

  return entries.map((entry) => {
    const entryTranslations = translationsByEntry.get(entry.id) ?? []
    const first = entryTranslations[0]
    const native = first ? nativeById.get(first.nativeEntryId)?.lemma : undefined
    const entryStates = entryTranslations.flatMap((t) => rsByTranslation.get(t.id) ?? [])
    const lastReview = entryStates.reduce((max, rs) => Math.max(max, rs.lastReview ?? 0), 0)
    return {
      entry,
      native,
      note: noteByEntry.get(entry.id),
      inStudySet: isInStudySet(entry, level, entryStates.length > 0),
      recognize: deriveStatus(first ? rsByKey.get(`${first.id}:recognize`) : undefined),
      produce: deriveStatus(first ? rsByKey.get(`${first.id}:produce`) : undefined),
      lastPracticed: lastReview || undefined,
      lapses: entryStates.reduce((max, rs) => Math.max(max, rs.lapses), 0),
    }
  })
}

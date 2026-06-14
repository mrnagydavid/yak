import { db } from './schema'
import { ulid } from './ids'
import { cefrRank, levelRank } from '../srs/levels'
import type { SessionCard } from '../srs/session-composer'
import type {
  Entry,
  EntryOverlay,
  PartOfSpeech,
  Profile,
  ReviewState,
  Skill,
  StudyPref,
  Translation,
} from './types'

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

/** Patch the active profile (level, daily limits, …). */
export function updateProfile(id: string, changes: Partial<Profile>): Promise<number> {
  return db.profiles.update(id, { ...changes, updatedAt: Date.now() })
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

/** Everything the Word Detail screen renders. (SPEC §7.5) */
export interface WordDetailData {
  entry: Entry
  natives: Entry[] // native-language entries this word translates to
  recognize?: ReviewState // primary translation's recognition state
  produce?: ReviewState // primary translation's production state
  lastPracticed?: number // most recent review across the word's skills
  overlay?: EntryOverlay
  /** What `study: 'auto'` resolves to for this word — i.e. is it in scope right now. */
  autoIncluded: boolean
}

export async function getWordDetail(entryId: string): Promise<WordDetailData | null> {
  const entry = await db.entries.get(entryId)
  if (!entry) return null

  const translations = await db.translations.where('targetEntryId').equals(entryId).toArray()
  const nativeEntries = await db.entries.bulkGet(translations.map((t) => t.nativeEntryId))
  const natives = nativeEntries.filter((e): e is Entry => Boolean(e))

  let recognize: ReviewState | undefined
  let produce: ReviewState | undefined
  let lastPracticed: number | undefined
  let hasSrs = false
  if (translations.length > 0) {
    const states = await db.reviewStates
      .where('translationId')
      .anyOf(translations.map((t) => t.id))
      .toArray()
    hasSrs = states.length > 0
    const primary = translations[0].id
    recognize = states.find((s) => s.translationId === primary && s.skill === 'recognize')
    produce = states.find((s) => s.translationId === primary && s.skill === 'produce')
    lastPracticed = states.reduce((max, s) => Math.max(max, s.lastReview ?? 0), 0) || undefined
  }

  // What 'auto' would resolve to — lets the Word Detail control hint the default outcome.
  const profile = await getActiveProfile()
  const level = profile?.claimedLevel ?? 'A1'

  const overlay = await getOverlay(entryId)
  return {
    entry,
    natives,
    recognize,
    produce,
    lastPracticed,
    overlay,
    autoIncluded: autoInScope(entry, level, hasSrs),
  }
}

/** Set a word's practice preference (skip / auto / always). (SPEC §7.5) */
export function setStudy(entryId: string, study: StudyPref): Promise<number> {
  return db.entries.update(entryId, { study, updatedAt: Date.now() })
}

/** A match in the Add flow: an entry, its primary translation, and study-set membership. */
export interface SearchMatch {
  entry: Entry
  native?: string
  inStudySet: boolean
}

/** Seed/user matches for the Add flow. (SPEC §7.4) */
export async function searchEntries(
  lang: string,
  level: Profile['claimedLevel'],
  query: string,
  limit = 8,
): Promise<SearchMatch[]> {
  // Strip a leading particle ("att" / "to") so "att springa" matches "springa".
  const q = query.trim().toLowerCase().replace(/^(att|to)\s+/, '')
  if (!q) return []
  // In-memory filter is fine at dev scale; the 8k-seed path will want an indexed prefix query.
  const entries = (await db.entries.where('lang').equals(lang).toArray())
    .filter((e) => e.lemma.toLowerCase().includes(q))
    .slice(0, limit)
  if (entries.length === 0) return []

  const translations = await db.translations.where('targetEntryId').anyOf(entries.map((e) => e.id)).toArray()
  const firstNativeId = new Map<string, string>()
  const translationIdsByEntry = new Map<string, string[]>()
  for (const t of translations) {
    if (!firstNativeId.has(t.targetEntryId)) firstNativeId.set(t.targetEntryId, t.nativeEntryId)
    const list = translationIdsByEntry.get(t.targetEntryId)
    if (list) list.push(t.id)
    else translationIdsByEntry.set(t.targetEntryId, [t.id])
  }
  const natives = await db.entries.bulkGet([...new Set(firstNativeId.values())])
  const lemmaById = new Map(natives.filter((n): n is Entry => Boolean(n)).map((n) => [n.id, n.lemma]))
  const states = await db.reviewStates.where('translationId').anyOf(translations.map((t) => t.id)).toArray()
  const withState = new Set(states.map((s) => s.translationId))

  return entries.map((entry) => {
    const hasSrs = (translationIdsByEntry.get(entry.id) ?? []).some((tid) => withState.has(tid))
    return {
      entry,
      native: firstNativeId.has(entry.id) ? lemmaById.get(firstNativeId.get(entry.id)!) : undefined,
      inStudySet: isInStudySet(entry, level, hasSrs),
    }
  })
}

/** Create or update an entry's overlay (note / examples / translation override). Deletes
 *  the overlay if everything is cleared. (SPEC §4.2, §7.5) */
export async function upsertOverlay(
  entryId: string,
  fields: { noteText?: string; customExamples?: string[]; customTranslation?: string },
  translationLang: string,
): Promise<void> {
  const now = Date.now()
  const existing = await getOverlay(entryId)
  const note = fields.noteText?.trim() || undefined
  const examples = (fields.customExamples ?? []).map((e) => e.trim()).filter(Boolean)
  const translation = fields.customTranslation?.trim() || undefined

  if (!note && examples.length === 0 && !translation) {
    if (existing) await db.entryOverlays.delete(existing.id)
    return
  }
  await db.entryOverlays.put({
    id: existing?.id ?? ulid(now),
    entryId,
    noteText: note,
    customExamples: examples.length ? examples : undefined,
    customTranslation: translation,
    translationLang,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
}

/** Reset a seed entry to its defaults — i.e. drop the user's overlay. (SPEC §7.5) */
export async function resetOverlay(entryId: string): Promise<void> {
  const existing = await getOverlay(entryId)
  if (existing) await db.entryOverlays.delete(existing.id)
}

/** Data the entry editor needs: the entry, its overlay, and its primary translation. */
export async function getEntryEditData(
  entryId: string,
): Promise<{ entry: Entry; overlay?: EntryOverlay; nativeLemma?: string } | null> {
  const entry = await db.entries.get(entryId)
  if (!entry) return null
  const overlay = await getOverlay(entryId)
  const translation = await db.translations.where('targetEntryId').equals(entryId).first()
  const native = translation ? await db.entries.get(translation.nativeEntryId) : undefined
  return { entry, overlay, nativeLemma: native?.lemma }
}

/** Edit a user entry's lemma / POS and its primary translation (the real native lemma). */
export async function updateUserEntry(
  entryId: string,
  fields: { lemma: string; pos: PartOfSpeech; translation: string },
): Promise<void> {
  const now = Date.now()
  const translation = await db.translations.where('targetEntryId').equals(entryId).first()
  await db.entries.update(entryId, { lemma: fields.lemma.trim(), pos: fields.pos, updatedAt: now })
  if (translation) {
    await db.entries.update(translation.nativeEntryId, {
      lemma: fields.translation.trim(),
      pos: fields.pos,
      updatedAt: now,
    })
  }
}

/** Reset one skill's SRS progress for an entry (delete those ReviewState rows). (SPEC §7.5) */
export async function resetSkill(entryId: string, skill: Skill): Promise<void> {
  const translations = await db.translations.where('targetEntryId').equals(entryId).toArray()
  const tids = translations.map((t) => t.id)
  if (tids.length === 0) return
  const states = await db.reviewStates.where('translationId').anyOf(tids).toArray()
  const ids = states.filter((s) => s.skill === skill).map((s) => s.id)
  if (ids.length) await db.reviewStates.bulkDelete(ids)
}

/** Delete a user entry and everything private to it (translations, states, overlay, native). */
export async function deleteUserEntry(entryId: string): Promise<void> {
  const translations = await db.translations.where('targetEntryId').equals(entryId).toArray()
  const tids = translations.map((t) => t.id)
  const states = tids.length ? await db.reviewStates.where('translationId').anyOf(tids).toArray() : []
  const overlay = await getOverlay(entryId)
  const natives = await db.entries.bulkGet(translations.map((t) => t.nativeEntryId))
  const userNativeIds = natives
    .filter((n): n is Entry => n !== undefined)
    .filter((n) => n.source === 'user')
    .map((n) => n.id)

  await db.transaction('rw', db.entries, db.translations, db.reviewStates, db.entryOverlays, async () => {
    if (states.length) await db.reviewStates.bulkDelete(states.map((s) => s.id))
    if (tids.length) await db.translations.bulkDelete(tids)
    if (overlay) await db.entryOverlays.delete(overlay.id)
    if (userNativeIds.length) await db.entries.bulkDelete(userNativeIds)
    await db.entries.delete(entryId)
  })
}

/** Create a user-authored entry (+ translation, + note overlay). Returns the entry id. (SPEC §7.4) */
export async function createUserEntry(input: {
  targetLang: string
  learnerLang: string
  lemma: string
  pos: PartOfSpeech
  translation: string
  note?: string
  ipa?: string // from enrichment
  gender?: string // from enrichment ("en" | "ett")
  inflections?: Record<string, string> // from enrichment
}): Promise<string> {
  const now = Date.now()
  const base = { features: {}, inflections: {}, pronunciation: {}, source: 'user' as const, createdAt: now, updatedAt: now }
  const target: Entry = {
    ...base,
    id: ulid(now),
    lang: input.targetLang,
    lemma: input.lemma.trim(),
    pos: input.pos,
    study: 'always',
    features: input.gender ? { gender: input.gender } : {},
    inflections: input.inflections ?? {},
    pronunciation: input.ipa?.trim() ? { ipa: input.ipa.trim(), ipaSource: 'ipa-dict' } : {},
  }
  const native: Entry = { ...base, id: ulid(now + 1), lang: input.learnerLang, lemma: input.translation.trim(), pos: input.pos, study: 'auto' }
  const translation: Translation = { id: ulid(now), targetEntryId: target.id, nativeEntryId: native.id, source: 'user', createdAt: now }

  await db.transaction('rw', db.entries, db.translations, db.entryOverlays, async () => {
    await db.entries.bulkAdd([target, native])
    await db.translations.add(translation)
    if (input.note?.trim()) {
      await db.entryOverlays.add({
        id: ulid(now),
        entryId: target.id,
        noteText: input.note.trim(),
        translationLang: input.learnerLang,
        createdAt: now,
        updatedAt: now,
      })
    }
  })
  return target.id
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

/** Whether a word would be practiced by default (study === 'auto'), per scope. (SPEC §6.1) */
function autoInScope(entry: Entry, level: Profile['claimedLevel'], hasSrs: boolean): boolean {
  return (
    entry.source === 'user' ||
    hasSrs ||
    (entry.source === 'seed' && cefrRank(entry.cefr) <= levelRank(level) + 1)
  )
}

/** Effective study-set membership: the `study` override resolved against scope. */
function isInStudySet(entry: Entry, level: Profile['claimedLevel'], hasSrs: boolean): boolean {
  if (entry.study === 'skip') return false
  if (entry.study === 'always') return true
  return autoInScope(entry, level, hasSrs)
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

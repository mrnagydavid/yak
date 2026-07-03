import { db } from './schema'
import { ulid } from './ids'
import { getRenderer } from '../lang'
import { applyRating, createReviewState } from '../srs/fsrs-adapter'
import { cefrRank, levelRank } from '../srs/levels'
import type { SessionCard } from '../srs/session-composer'
import type {
  Cefr,
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

/** Create the (single) active profile at the end of onboarding. Defaults match the former
 *  auto-created profile. (SPEC §7.8) */
export function createProfile(input: {
  learnerLang: string
  targetLang: string
  claimedLevel: Profile['claimedLevel']
}): Promise<string> {
  const now = Date.now()
  return db.profiles.add({
    id: ulid(now),
    learnerLang: input.learnerLang,
    targetLang: input.targetLang,
    claimedLevel: input.claimedLevel,
    dailyLimits: { newPerDay: 20, practicePerDay: 200 },
    active: true,
    createdAt: now,
    updatedAt: now,
  })
}

// ---------- calibration sweep (SPEC §6.4) ----------

export interface CalibrationItem {
  translationId: string // seeded (both skills) when the user can produce it
  prompt: string // the native-language meaning shown — the learner recalls the target word
  answer: string // the target word, revealed so the learner can verify before rating
  ipa?: string // target IPA, shown on reveal if available
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** Up to `n` random seed words at a CEFR level, each as the native-language prompt the learner tries
 *  to produce the target word for. Calibration tests production (the level that gates practice),
 *  since recognition over-places — you understand far more than you can produce. (SPEC §6.4) */
export async function drawCalibrationItems(targetLang: string, level: Cefr, n: number): Promise<CalibrationItem[]> {
  const entries = (await db.entries.where('cefr').equals(level).toArray()).filter(
    (e) => e.lang === targetLang && e.source === 'seed',
  )
  const picked = shuffle(entries).slice(0, n)
  const translations = await db.translations.where('targetEntryId').anyOf(picked.map((e) => e.id)).toArray()
  // Calibration tests the primary meaning (recognition is per word); prefer it over an extra meaning.
  const firstTr = new Map<string, Translation>()
  for (const t of translations) if (t.primary || !firstTr.has(t.targetEntryId)) firstTr.set(t.targetEntryId, t)
  const natives = await db.entries.bulkGet([...new Set([...firstTr.values()].map((t) => t.nativeEntryId))])
  const nativeById = new Map(natives.filter((e): e is Entry => !!e).map((e) => [e.id, e]))
  const targetRenderer = getRenderer(targetLang)
  return picked.flatMap((entry) => {
    const tr = firstTr.get(entry.id)
    const native = tr ? nativeById.get(tr.nativeEntryId) : undefined
    if (!tr || !native) return []
    return [
      {
        translationId: tr.id,
        prompt: getRenderer(native.lang).renderLemma(native),
        answer: targetRenderer.renderLemma(entry),
        ipa: targetRenderer.showIpa ? entry.pronunciation.ipa : undefined,
      },
    ]
  })
}

/** Seed both skills as `Good` for a word the user can produce during calibration — producing it
 *  implies recognising it. Additive: leaves any existing state untouched (a Don't-know writes
 *  nothing at all). (SPEC §6.4) */
export async function seedKnown(translationId: string, now: number = Date.now()): Promise<void> {
  for (const skill of ['recognize', 'produce'] as const) {
    if (await getReviewState(translationId, skill)) continue
    await db.reviewStates.put(applyRating(createReviewState(translationId, skill, now), 'good', now))
  }
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

/** Concept-level "what you've learned" summary for a word that belongs to a sense group. (Q1) */
export interface SenseSummary {
  concept: string // the English word (clean label from the sense key), e.g. "clearly"
  meaningsLearned: number // distinct senses of that concept you've learned at least one word for
  synonyms: string[] // OTHER already-learned words in THIS word's sense (rendered), excluding itself
}

/**
 * Summarise the concept a word belongs to (via its sense key): how many of its meanings you've learned,
 * and the same-sense synonyms you already know. Returns null when the word has no sense or no sibling.
 * Filters the language by sense-key prefix in memory — only called on new-card reveal / Word Detail, so
 * the scan is fine (no index needed).
 */
export async function getSenseSummary(entry: Entry): Promise<SenseSummary | null> {
  const key = entry.sense?.key
  if (!key) return null
  const hash = key.lastIndexOf('#')
  if (hash < 0) return null
  const prefix = key.slice(0, hash + 1) // "clearly#" — all senses of this concept
  const concept = key.slice(0, hash).split(/[,(]/)[0].trim() // clean label for display
  const siblings = (await db.entries.where('lang').equals(entry.lang).toArray()).filter((e) =>
    e.sense?.key?.startsWith(prefix),
  )
  if (siblings.length < 2) return null

  const trs = await db.translations.where('targetEntryId').anyOf(siblings.map((s) => s.id)).toArray()
  const trsByTarget = new Map<string, string[]>()
  for (const t of trs) {
    const list = trsByTarget.get(t.targetEntryId) ?? []
    list.push(t.id)
    trsByTarget.set(t.targetEntryId, list)
  }
  const states = trs.length
    ? await db.reviewStates.where('translationId').anyOf(trs.map((t) => t.id)).toArray()
    : []
  const learnedTr = new Set(states.map((s) => s.translationId))
  const learned = siblings.filter((s) => (trsByTarget.get(s.id) ?? []).some((tid) => learnedTr.has(tid)))

  const meaningsLearned = new Set(learned.map((s) => s.sense!.key)).size
  const synonyms = learned
    .filter((s) => s.sense!.key === key && s.id !== entry.id)
    .map((s) => getRenderer(s.lang).renderLemma(s))
  return { concept, meaningsLearned, synonyms }
}

/** One answer of a multi-answer production card: its translation + resolved target entry + overlay. */
export interface PracticeGroupMember {
  translationId: string
  target: Entry
  overlay?: EntryOverlay
  /** Which meaning of the target word this answer is (0 = primary, 1+ = a promoted meaning), so the
   *  reveal shows only this meaning's examples. (per-sense examples, §4.8) */
  meaningKey: number
}

/** Everything the Practice card needs to render: the session card plus resolved entities. */
export interface PracticeCardView {
  card: SessionCard
  target: Entry
  native?: Entry
  overlay?: EntryOverlay
  /** True when another target-language entry renders to the SAME prompt form (homonym the prompt
   *  can't tell apart, e.g. fast conj/adj, en krona crown/currency). The article/"att" already
   *  separates en val / ett val / att-verbs, so those don't count. The prompt then shows a
   *  sense-specific example so the recall is well-posed. (SPEC §7.2) */
  ambiguous: boolean
  /** Present on a multi-answer PRODUCTION card (SessionCard.group): the concept's sense gloss and the
   *  resolved target entry for each valid answer, so the reveal can list them all. (plan) */
  group?: { gloss: string; members: PracticeGroupMember[] }
  /** Attached on NEW cards whose word belongs to a sense group, so the reveal can relate it to
   *  synonyms/meanings already learned. (Q1) */
  senseSummary?: SenseSummary
  /** The word's OTHER taught meanings (rendered native lemmas), for reveal cross-linking on a
   *  multi-meaning word. Recognition lists them all ("led means: joint, route"); production points at
   *  the siblings ("led also means: joint"). Empty for single-meaning words. (multi-meaning design) */
  siblingMeanings: string[]
  /** The production-prompt gloss for THIS card's meaning: the primary reads its word's sense gloss,
   *  a promoted meaning reads its own link gloss — so the hint tracks the exact meaning asked, never
   *  leaking the primary's gloss onto a promoted card. Undefined/empty when unambiguous. (§12) */
  productionGloss?: string
  /** Which meaning of the target word this (solo) card asks (0 = primary, 1+ = a promoted meaning), so
   *  a production reveal shows only this meaning's examples. Group cards carry it per member. (§4.8) */
  meaningKey: number
}

/** Resolve a session card's display data. Returns null if the target entry is missing. */
export async function getPracticeCardView(card: SessionCard): Promise<PracticeCardView | null> {
  const target = await db.entries.get(card.targetEntryId)
  if (!target) return null
  const translation = await db.translations.get(card.translationId)
  const native = translation ? await db.entries.get(translation.nativeEntryId) : undefined
  const overlay = await getOverlay(target.id)

  // Multi-answer production: resolve every valid answer's target entry for the reveal. The prompt is
  // the shared native concept (`native`); the gloss says which sense. It is read from the REPRESENTATIVE
  // meaning by the same rule solo cards use (primary → its word's `sense.gloss`; a promoted meaning →
  // its own link gloss), so a group whose representative is a promoted meaning shows that meaning's
  // gloss, not the representative word's primary gloss. No homonym cue here — count + gloss disambiguate.
  if (card.group) {
    const targets = await db.entries.bulkGet(card.group.members.map((m) => m.targetEntryId))
    const byId = new Map(targets.filter((e): e is Entry => Boolean(e)).map((e) => [e.id, e]))
    const memberTrs = await db.translations.bulkGet(card.group.members.map((m) => m.translationId))
    const meaningKeyByTr = new Map(memberTrs.filter((t): t is Translation => Boolean(t)).map((t) => [t.id, t.meaningKey]))
    const members: PracticeGroupMember[] = []
    for (const m of card.group.members) {
      const t = byId.get(m.targetEntryId)
      if (t) members.push({ translationId: m.translationId, target: t, overlay: await getOverlay(t.id), meaningKey: meaningKeyByTr.get(m.translationId) ?? 0 })
    }
    const groupGloss = translation?.primary === false ? (translation.gloss ?? '') : (target.sense?.gloss ?? '')
    // A group card is a synonym group, not a multi-meaning word — no meaning cross-linking here.
    return { card, target, native, overlay, ambiguous: false, siblingMeanings: [], group: { gloss: groupGloss, members }, meaningKey: translation?.meaningKey ?? 0 }
  }

  // The word's OTHER taught meanings, for reveal cross-linking on a multi-meaning word (led → joint,
  // route). Recognition (on the primary) lists them all; production (on any meaning) points at the rest.
  const allTranslations = await db.translations.where('targetEntryId').equals(target.id).toArray()
  const otherNativeIds = allTranslations.filter((t) => t.id !== card.translationId).map((t) => t.nativeEntryId)
  const otherNatives = otherNativeIds.length ? await db.entries.bulkGet(otherNativeIds) : []
  const siblingMeanings = otherNatives.filter((e): e is Entry => Boolean(e)).map((e) => getRenderer(e.lang).renderLemma(e))

  // Ambiguous = the rendered prompt form collides with another same-lemma card. en/ett/att that
  // already disambiguate suppress it; only genuine same-form homonyms keep the cue.
  const siblings = await db.entries.where('[lang+lemma]').equals([target.lang, target.lemma]).toArray()
  const render = getRenderer(target.lang).renderLemma
  const targetForm = render(target)
  const sameForm = siblings.filter((e) => render(e) === targetForm).length
  // On a new card, summarise the word's concept (synonyms/meanings already learned) for the reveal.
  const senseSummary = card.mode === 'new' ? ((await getSenseSummary(target)) ?? undefined) : undefined
  // The prompt hint: primary meaning → the word's sense gloss; a promoted meaning → its own link
  // gloss (never the primary's, which would mislabel it). Recognition ignores it (self-evident cue).
  const productionGloss = translation?.primary === false ? translation.gloss : target.sense?.gloss
  return { card, target, native, overlay, ambiguous: sameForm > 1, senseSummary, siblingMeanings, productionGloss, meaningKey: translation?.meaningKey ?? 0 }
}

/** One practiceable meaning of a word, with its own production progress. (multi-meaning design) */
export interface MeaningProgress {
  translationId: string
  meaningKey: number
  native: string // rendered native lemma (the meaning label)
  produce?: ReviewState // this meaning's production state
}

/** Everything the Word Detail screen renders. (SPEC §7.5) */
export interface WordDetailData {
  entry: Entry
  natives: Entry[] // native-language entries this word translates to, primary meaning first
  recognize?: ReviewState // the word's recognition state (carried by the primary meaning)
  meanings: MeaningProgress[] // per-meaning production, primary first (multi-meaning design)
  lastPracticed?: number // most recent review across the word's skills
  overlay?: EntryOverlay
  /** What `study: 'auto'` resolves to for this word — i.e. is it in scope right now. */
  autoIncluded: boolean
  /** Concept-level learning summary, when the word belongs to a sense group. (Q1) */
  senseSummary?: SenseSummary
}

export async function getWordDetail(entryId: string): Promise<WordDetailData | null> {
  const entry = await db.entries.get(entryId)
  if (!entry) return null

  // Order by meaningKey so the primary meaning (0) leads; a word may link to several meanings.
  const translations = (await db.translations.where('targetEntryId').equals(entryId).toArray()).sort(
    (a, b) => a.meaningKey - b.meaningKey,
  )
  const nativeEntries = await db.entries.bulkGet(translations.map((t) => t.nativeEntryId))
  const nativeByTr = new Map(translations.map((t, i) => [t.id, nativeEntries[i]]))
  const natives = nativeEntries.filter((e): e is Entry => Boolean(e))

  let recognize: ReviewState | undefined
  let lastPracticed: number | undefined
  let hasSrs = false
  const meanings: MeaningProgress[] = []
  if (translations.length > 0) {
    const states = await db.reviewStates
      .where('translationId')
      .anyOf(translations.map((t) => t.id))
      .toArray()
    hasSrs = states.length > 0
    // Recognition is per WORD — carried by the primary meaning (meaningKey 0). Production is per meaning.
    const primary = translations.find((t) => t.primary) ?? translations[0]
    recognize = states.find((s) => s.translationId === primary.id && s.skill === 'recognize')
    lastPracticed = states.reduce((max, s) => Math.max(max, s.lastReview ?? 0), 0) || undefined
    for (const t of translations) {
      const native = nativeByTr.get(t.id)
      if (!native) continue
      meanings.push({
        translationId: t.id,
        meaningKey: t.meaningKey,
        native: getRenderer(native.lang).renderLemma(native),
        produce: states.find((s) => s.translationId === t.id && s.skill === 'produce'),
      })
    }
  }

  // What 'auto' would resolve to — lets the Word Detail control hint the default outcome.
  const profile = await getActiveProfile()
  const level = profile?.claimedLevel ?? 'A1'

  const overlay = await getOverlay(entryId)
  return {
    entry,
    natives,
    recognize,
    meanings,
    lastPracticed,
    overlay,
    autoIncluded: autoInScope(entry, level, hasSrs),
    senseSummary: (await getSenseSummary(entry)) ?? undefined,
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
    // Show the primary meaning as the headline (fall back to first-seen for pre-primary data).
    if (t.primary || !firstNativeId.has(t.targetEntryId)) firstNativeId.set(t.targetEntryId, t.nativeEntryId)
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

/** Edit a user entry's lemma / POS / inflections and its primary translation. */
export async function updateUserEntry(
  entryId: string,
  fields: { lemma: string; pos: PartOfSpeech; translation: string; inflections?: Record<string, string> },
): Promise<void> {
  const now = Date.now()
  const translation = await db.translations.where('targetEntryId').equals(entryId).first()
  await db.entries.update(entryId, {
    lemma: fields.lemma.trim(),
    pos: fields.pos,
    inflections: fields.inflections ?? {},
    updatedAt: now,
  })
  if (translation) {
    await db.entries.update(translation.nativeEntryId, {
      lemma: fields.translation.trim(),
      pos: fields.pos,
      updatedAt: now,
    })
  }
}

/** Reset one skill's SRS progress for an entry (delete those ReviewState rows). (SPEC §7.5)
 *  Recognition is per word; for production of a multi-meaning word this resets every meaning — use
 *  resetProduction for a single meaning. */
export async function resetSkill(entryId: string, skill: Skill): Promise<void> {
  const translations = await db.translations.where('targetEntryId').equals(entryId).toArray()
  const tids = translations.map((t) => t.id)
  if (tids.length === 0) return
  const states = await db.reviewStates.where('translationId').anyOf(tids).toArray()
  const ids = states.filter((s) => s.skill === skill).map((s) => s.id)
  if (ids.length) await db.reviewStates.bulkDelete(ids)
}

/** Reset one meaning's production progress (delete its produce ReviewState). (multi-meaning design) */
export async function resetProduction(translationId: string): Promise<void> {
  const state = await getReviewState(translationId, 'produce')
  if (state) await db.reviewStates.delete(state.id)
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
  const translation: Translation = { id: ulid(now), targetEntryId: target.id, nativeEntryId: native.id, meaningKey: 0, primary: true, source: 'user', createdAt: now }

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
  // Every practiced meaning (primary + promoted), primary-first and deduped. Drives both search
  // (so a promoted sense like "husband" surfaces its word `man`) and the `→ …` display. Reference-
  // only subDefinitions aren't practiced cards, so they're excluded. (multi-meaning design)
  meanings: string[]
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
    // Status tracks the PRIMARY meaning (a multi-meaning word still shows as one row).
    const first = entryTranslations.find((t) => t.primary) ?? entryTranslations[0]
    // Every practiced meaning's lemma, ordered primary-first by meaningKey and deduped, so search
    // finds a promoted meaning ("husband" → man) and the row can show the full list.
    const meanings = [
      ...new Set(
        [...entryTranslations]
          .sort((a, b) => a.meaningKey - b.meaningKey)
          .map((t) => nativeById.get(t.nativeEntryId)?.lemma)
          .filter((l): l is string => Boolean(l)),
      ),
    ]
    const entryStates = entryTranslations.flatMap((t) => rsByTranslation.get(t.id) ?? [])
    const lastReview = entryStates.reduce((max, rs) => Math.max(max, rs.lastReview ?? 0), 0)
    return {
      entry,
      meanings,
      note: noteByEntry.get(entry.id),
      inStudySet: isInStudySet(entry, level, entryStates.length > 0),
      recognize: deriveStatus(first ? rsByKey.get(`${first.id}:recognize`) : undefined),
      produce: deriveStatus(first ? rsByKey.get(`${first.id}:produce`) : undefined),
      lastPracticed: lastReview || undefined,
      lapses: entryStates.reduce((max, rs) => Math.max(max, rs.lapses), 0),
    }
  })
}

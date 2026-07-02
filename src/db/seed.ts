import { ulid } from './ids'
import { db } from './schema'
import type { Cefr, Entry, PartOfSpeech, Translation } from './types'

// Loads the real Swedish seed (data → public/seed-sv.json, from scripts/seed) into Dexie on first
// launch, and on later launches syncs a shipped seed update onto the existing DB without resetting
// progress. Matching is by `seedKey` (the Kelly id baked into the seed). (SPEC §9, §13)

/** An extra practiceable meaning of a word beyond the primary `translation` (multi-meaning design).
 *  Each becomes its own native Entry + Translation join row (production-only card). `key` is the
 *  stable per-word meaningKey (1, 2, …) for seed-sync. */
interface AltMeaning {
  key: number
  translation: string
  enUncountable?: boolean
  gloss?: string // production-prompt hint when this meaning's English is ambiguous (§12); sense pass owns it
  senseKey?: string // production-grouping key (`english#sense`) so this meaning groups with its synonyms (§12); sense pass owns it
}
interface SeedEntry {
  seedKey: number
  lemma: string
  pos: PartOfSpeech
  cefr: Cefr
  gender?: string
  ipa?: string
  inflections?: Record<string, string>
  subDefinitions?: string[]
  examples?: string[]
  translation: string
  altMeanings?: AltMeaning[] // extra practiceable meanings (each its own card); primary is `translation`
  sense?: { key: string; gloss: string } // production grouping: which sense of `translation` this is
  enUncountable?: boolean // English translation is an uncountable noun → renderer omits the article
  svUncountable?: boolean // Swedish lemma is a mass noun → renderer omits the article ("folk", not "ett folk")
  ipaAmbiguous?: boolean // same lemma pronounced differently across senses → suppress TTS
  h?: string // per-entry content hash (changed-only sync); absent on pre-hash seeds
}
interface SeedFile {
  version: string
  entries: SeedEntry[]
}

const TARGET_LANG = 'sv'
const NATIVE_LANG = 'en'

async function fetchSeed(): Promise<SeedFile> {
  const res = await fetch(`${import.meta.env.BASE_URL}seed-sv.json`)
  if (!res.ok) throw new Error(`seed HTTP ${res.status}`)
  return (await res.json()) as SeedFile
}

/** Fetch just the shipped seed version (a few bytes), avoiding the 2.2MB seed parse on the common
 *  no-update launch. Returns undefined if version.json is unavailable, so the caller falls back to
 *  the full fetch (whose own version guard then makes it a no-op). */
async function fetchSeedVersion(): Promise<string | undefined> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`)
    if (!res.ok) return undefined
    return ((await res.json()) as { version?: string }).version
  } catch {
    return undefined
  }
}

// The seed version the DB has been synced to. Authoritative (unlike a per-entry seedVersion, which
// changed-only sync leaves stale on untouched rows). Read by the startup gate, written after sync.
const SEED_VERSION_KEY = 'seedVersion'
const getSyncedSeedVersion = async (): Promise<string | undefined> => (await db.meta.get(SEED_VERSION_KEY))?.value
const setSyncedSeedVersion = (version: string): Promise<string> => db.meta.put({ key: SEED_VERSION_KEY, value: version })

/** Build a native (translation) Entry for one meaning of a word. */
function buildNative(lemma: string, pos: PartOfSpeech, uncountable: boolean, version: string, now: number): Entry {
  return {
    id: ulid(),
    lang: NATIVE_LANG,
    lemma,
    pos,
    // Uncountable English nouns drop the "a/an" the renderer would otherwise add (e.g. "abuse").
    features: uncountable ? { countable: 'no' } : {},
    inflections: {},
    pronunciation: {},
    source: 'seed',
    seedVersion: version,
    study: 'auto',
    createdAt: now,
    updatedAt: now,
  }
}

/** The meanings of a seed entry, primary first (meaningKey 0), then each promoted altMeaning.
 *  A promoted meaning may carry a `gloss` (its production-prompt hint) and a `senseKey` (its
 *  production-grouping key); the primary's gloss/key live on `Entry.sense`, so meaningKey 0 never
 *  sets a link gloss/senseKey here. */
function seedMeanings(s: SeedEntry): { key: number; translation: string; enUncountable: boolean; gloss?: string; senseKey?: string }[] {
  return [
    { key: 0, translation: s.translation, enUncountable: s.enUncountable === true },
    ...(s.altMeanings ?? []).map((m) => ({ key: m.key, translation: m.translation, enUncountable: m.enUncountable === true, gloss: m.gloss, senseKey: m.senseKey })),
  ]
}

/** Build the target entry plus one native Entry + Translation link per practiceable meaning. A
 *  single-meaning word yields one link (meaningKey 0, primary); a multi-meaning word fans out into
 *  N links, the primary carrying the word's recognition. (multi-meaning design) */
function buildEntry(s: SeedEntry, version: string, now: number): { target: Entry; natives: Entry[]; translations: Translation[] } {
  const target: Entry = {
    id: ulid(),
    lang: TARGET_LANG,
    lemma: s.lemma,
    pos: s.pos,
    features: { ...(s.gender ? { gender: s.gender } : {}), ...(s.svUncountable ? { countable: 'no' } : {}) },
    inflections: s.inflections ?? {},
    pronunciation: s.ipa ? { ipa: s.ipa, ipaSource: 'wiktionary', ...(s.ipaAmbiguous ? { ambiguous: true } : {}) } : {},
    cefr: s.cefr,
    subDefinitions: s.subDefinitions,
    sense: s.sense,
    examples: s.examples,
    source: 'seed',
    seedVersion: version,
    seedKey: s.seedKey,
    seedHash: s.h,
    study: 'auto',
    createdAt: now,
    updatedAt: now,
  }
  const natives: Entry[] = []
  const translations: Translation[] = []
  for (const m of seedMeanings(s)) {
    const native = buildNative(m.translation, s.pos, m.enUncountable, version, now)
    natives.push(native)
    translations.push({
      id: ulid(),
      targetEntryId: target.id,
      nativeEntryId: native.id,
      meaningKey: m.key,
      primary: m.key === 0,
      ...(m.gloss ? { gloss: m.gloss } : {}),
      ...(m.senseKey ? { senseKey: m.senseKey } : {}),
      source: 'seed',
      createdAt: now,
    })
  }
  return { target, natives, translations }
}

async function importSeed(seed: SeedFile): Promise<void> {
  const now = Date.now()
  const entries: Entry[] = []
  const translations: Translation[] = []
  for (const s of seed.entries) {
    const { target, natives, translations: trs } = buildEntry(s, seed.version, now)
    entries.push(target, ...natives)
    translations.push(...trs)
  }
  await db.transaction('rw', db.entries, db.translations, async () => {
    await db.entries.bulkAdd(entries)
    await db.translations.bulkAdd(translations)
  })
  await setSyncedSeedVersion(seed.version)
}

/** True when the seed was imported fresh (first launch); false when the DB already had data — in
 *  which case a shipped seed update is synced in, preserving SRS progress and user overlays. */
export async function loadSeedIfEmpty(): Promise<boolean> {
  if ((await db.entries.count()) === 0) {
    await importSeed(await fetchSeed())
    return true
  }
  // Best-effort: sync a shipped wordlist update onto the existing DB. Never blocks startup.
  // Fast path: compare the tiny version.json against the DB before touching the 2.2MB seed — on the
  // common launch (no update) this skips the seed fetch+parse entirely.
  try {
    const shippedVersion = await fetchSeedVersion()
    const currentVersion = await getSyncedSeedVersion()
    if (shippedVersion === undefined || shippedVersion !== currentVersion) {
      await syncSeed(await fetchSeed())
    }
  } catch (e) {
    console.warn('seed sync skipped:', e)
  }
  return false
}

// ---------- sync ----------

export interface SyncTarget {
  id: string
  seedKey?: number
  seedHash?: string
  lemma: string
  pos: string
}
export interface SyncPlan {
  adds: SeedEntry[]
  updates: { id: string; seed: SeedEntry }[]
  deletes: string[]
}

/** Pure diff of existing seed target-entries against a new seed, keyed by `seedKey`. Matched cards
 *  whose content hash changed are updated in place (preserving progress); a matched card with an
 *  unchanged hash is left alone (changed-only sync). Cards no longer in the seed are deleted (policy:
 *  a word removed from the seed should stop appearing); the rest are added. Every seed entry carries
 *  a seedKey from the build, so any existing entry without one is foreign/stale and is dropped — the
 *  app is re-seeded once (resetYak) to establish the seedKey baseline. */
export function planSeedSync(existing: SyncTarget[], seedEntries: SeedEntry[]): SyncPlan {
  const byKey = new Map<number, SeedEntry>()
  for (const s of seedEntries) byKey.set(s.seedKey, s)

  const claimed = new Set<number>()
  const updates: { id: string; seed: SeedEntry }[] = []
  const deletes: string[] = []

  for (const e of existing) {
    const match = e.seedKey === undefined ? undefined : byKey.get(e.seedKey)
    if (match && claimed.has(match.seedKey) === false) {
      claimed.add(match.seedKey)
      // Only rewrite when the content actually changed. An existing entry without a stored hash
      // (pre-hash DB) has seedHash === undefined, so it updates once and backfills the hash.
      if (e.seedHash !== match.h) updates.push({ id: e.id, seed: match })
    } else {
      deletes.push(e.id)
    }
  }
  const adds = seedEntries.filter((s) => claimed.has(s.seedKey) === false)
  return { adds, updates, deletes }
}

async function syncSeed(seed: SeedFile): Promise<void> {
  if ((await getSyncedSeedVersion()) === seed.version) return // already on this seed version

  const seedTargets = (await db.entries.where('source').equals('seed').toArray()).filter((e) => e.lang === TARGET_LANG)
  const plan = planSeedSync(
    seedTargets.map((t) => ({ id: t.id, seedKey: t.seedKey, seedHash: t.seedHash, lemma: t.lemma, pos: t.pos })),
    seed.entries,
  )

  const now = Date.now()
  await db.transaction('rw', db.entries, db.translations, db.reviewStates, db.entryOverlays, async () => {
    for (const id of plan.deletes) await deleteSeedTarget(id)
    for (const u of plan.updates) await updateSeedTarget(u.id, u.seed, seed.version, now)
    for (const s of plan.adds) {
      const { target, natives, translations: trs } = buildEntry(s, seed.version, now)
      await db.entries.bulkAdd([target, ...natives])
      await db.translations.bulkAdd(trs)
    }
  })
  await setSyncedSeedVersion(seed.version)
  console.info(`seed synced → ${seed.version}: +${plan.adds.length} ~${plan.updates.length} -${plan.deletes.length}`)
}

/** Update a seed target + reconcile its full set of meanings in place — same ids, so reviewStates and
 *  the user's overlay are preserved (policy: a changed translation keeps the learner's progress).
 *
 *  The meaning set is reconciled by `meaningKey`: a matched meaning updates its native entry in place
 *  (its ReviewState survives); a new meaning adds a native entry + link; a removed meaning is deleted
 *  along with its native entry and review states. This is the multi-meaning upgrade path — the
 *  highest-risk piece, because it must never silently lose a learner's progress on a meaning it kept. */
async function updateSeedTarget(targetId: string, s: SeedEntry, version: string, now: number): Promise<void> {
  await db.entries.update(targetId, {
    lemma: s.lemma,
    pos: s.pos,
    features: { ...(s.gender ? { gender: s.gender } : {}), ...(s.svUncountable ? { countable: 'no' } : {}) },
    inflections: s.inflections ?? {},
    pronunciation: s.ipa ? { ipa: s.ipa, ipaSource: 'wiktionary', ...(s.ipaAmbiguous ? { ambiguous: true } : {}) } : {},
    cefr: s.cefr,
    subDefinitions: s.subDefinitions,
    sense: s.sense,
    examples: s.examples,
    seedVersion: version,
    seedKey: s.seedKey,
    seedHash: s.h,
    updatedAt: now,
  })

  const existing = await db.translations.where('targetEntryId').equals(targetId).toArray()
  const plan = planMeaningSync(existing, seedMeanings(s))

  for (const u of plan.updates) {
    // Matched meaning: update its native entry in place — the link id (and its ReviewState) survive.
    await db.entries.update(u.nativeEntryId, {
      lemma: u.meaning.translation,
      pos: s.pos,
      features: u.meaning.enUncountable ? { countable: 'no' } : {},
      seedVersion: version,
      updatedAt: now,
    })
    // Reconcile the link's fields the seed owns: the primary flag (only when it must flip) and the
    // promoted-meaning gloss + senseKey (which a curation change may add/alter/clear on a matched link).
    await db.translations.update(u.id, {
      ...(u.setPrimary !== undefined ? { primary: u.setPrimary } : {}),
      gloss: u.meaning.gloss,
      senseKey: u.meaning.senseKey,
    })
  }
  for (const m of plan.adds) {
    // New meaning added by a seed update: fresh native entry + link (no prior progress to preserve).
    const native = buildNative(m.translation, s.pos, m.enUncountable, version, now)
    await db.entries.add(native)
    await db.translations.add({
      id: ulid(),
      targetEntryId: targetId,
      nativeEntryId: native.id,
      meaningKey: m.key,
      primary: m.key === 0,
      ...(m.gloss ? { gloss: m.gloss } : {}),
      ...(m.senseKey ? { senseKey: m.senseKey } : {}),
      source: 'seed',
      createdAt: now,
    })
  }
  // Meanings removed from the seed: delete the link, its native entry, and its review states.
  for (const d of plan.deletes) {
    const states = await db.reviewStates.where('translationId').equals(d.id).toArray()
    if (states.length) await db.reviewStates.bulkDelete(states.map((r) => r.id))
    await db.entries.delete(d.nativeEntryId)
    await db.translations.delete(d.id)
  }
}

interface SeedMeaning {
  key: number
  translation: string
  enUncountable: boolean
  gloss?: string // promoted-meaning production hint; carried onto the Translation link
  senseKey?: string // promoted-meaning production-grouping key; carried onto the Translation link
}
export interface MeaningSyncPlan {
  updates: { id: string; nativeEntryId: string; meaning: SeedMeaning; setPrimary?: boolean }[]
  adds: SeedMeaning[]
  deletes: { id: string; nativeEntryId: string }[]
}

/** Pure reconciliation of a word's existing meaning links against the seed's meanings, matched by
 *  `meaningKey`. A matched key updates in place (its link id — and thus ReviewState — is preserved);
 *  a new key is added; a key no longer in the seed is deleted. `setPrimary` is set only when a matched
 *  link's primary flag must flip (e.g. a pre-v6 backfill), avoiding a redundant write. This is the
 *  progress-preserving core of the multi-meaning upgrade path — kept pure so it is directly tested. */
export function planMeaningSync(
  existing: { id: string; nativeEntryId: string; meaningKey: number; primary: boolean }[],
  wanted: SeedMeaning[],
): MeaningSyncPlan {
  const byKey = new Map(existing.map((t) => [t.meaningKey, t]))
  const wantedKeys = new Set(wanted.map((m) => m.key))
  const updates: MeaningSyncPlan['updates'] = []
  const adds: SeedMeaning[] = []
  for (const m of wanted) {
    const match = byKey.get(m.key)
    if (match) {
      const wantPrimary = m.key === 0
      updates.push({ id: match.id, nativeEntryId: match.nativeEntryId, meaning: m, ...(match.primary !== wantPrimary ? { setPrimary: wantPrimary } : {}) })
    } else {
      adds.push(m)
    }
  }
  const deletes = existing.filter((t) => !wantedKeys.has(t.meaningKey)).map((t) => ({ id: t.id, nativeEntryId: t.nativeEntryId }))
  return { updates, adds, deletes }
}

/** Remove a seed target entirely — its translation(s), native entry, review states and overlay —
 *  per policy: a word dropped from the seed should stop appearing (it may have been faulty). */
async function deleteSeedTarget(targetId: string): Promise<void> {
  const trs = await db.translations.where('targetEntryId').equals(targetId).toArray()
  for (const tr of trs) {
    const states = await db.reviewStates.where('translationId').equals(tr.id).toArray()
    await db.reviewStates.bulkDelete(states.map((r) => r.id))
    await db.entries.delete(tr.nativeEntryId)
    await db.translations.delete(tr.id)
  }
  const overlay = await db.entryOverlays.where('entryId').equals(targetId).first()
  if (overlay) await db.entryOverlays.delete(overlay.id)
  await db.entries.delete(targetId)
}

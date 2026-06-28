import { ulid } from './ids'
import { db } from './schema'
import type { Cefr, Entry, PartOfSpeech, Translation } from './types'

// Loads the real Swedish seed (data → public/seed-sv.json, from scripts/seed) into Dexie on first
// launch, and on later launches syncs a shipped seed update onto the existing DB without resetting
// progress. Matching is by `seedKey` (the Kelly id baked into the seed). (SPEC §9, §13)

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

/** Build the target entry, its native (translation) entry, and the link between them. */
function buildPair(s: SeedEntry, version: string, now: number): { target: Entry; native: Entry; translation: Translation } {
  const target: Entry = {
    id: ulid(),
    lang: TARGET_LANG,
    lemma: s.lemma,
    pos: s.pos,
    features: s.gender ? { gender: s.gender } : {},
    inflections: s.inflections ?? {},
    pronunciation: s.ipa ? { ipa: s.ipa, ipaSource: 'wiktionary', ...(s.ipaAmbiguous ? { ambiguous: true } : {}) } : {},
    cefr: s.cefr,
    subDefinitions: s.subDefinitions,
    examples: s.examples,
    source: 'seed',
    seedVersion: version,
    seedKey: s.seedKey,
    seedHash: s.h,
    study: 'auto',
    createdAt: now,
    updatedAt: now,
  }
  const native: Entry = {
    id: ulid(),
    lang: NATIVE_LANG,
    lemma: s.translation,
    pos: s.pos,
    features: {},
    inflections: {},
    pronunciation: {},
    source: 'seed',
    seedVersion: version,
    study: 'auto',
    createdAt: now,
    updatedAt: now,
  }
  const translation: Translation = { id: ulid(), targetEntryId: target.id, nativeEntryId: native.id, source: 'seed', createdAt: now }
  return { target, native, translation }
}

async function importSeed(seed: SeedFile): Promise<void> {
  const now = Date.now()
  const entries: Entry[] = []
  const translations: Translation[] = []
  for (const s of seed.entries) {
    const { target, native, translation } = buildPair(s, seed.version, now)
    entries.push(target, native)
    translations.push(translation)
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
      const { target, native, translation } = buildPair(s, seed.version, now)
      await db.entries.bulkAdd([target, native])
      await db.translations.add(translation)
    }
  })
  await setSyncedSeedVersion(seed.version)
  console.info(`seed synced → ${seed.version}: +${plan.adds.length} ~${plan.updates.length} -${plan.deletes.length}`)
}

/** Update a seed target + its translation in place — same ids, so reviewStates and the user's
 *  overlay are preserved (policy: a changed translation keeps the learner's progress). */
async function updateSeedTarget(targetId: string, s: SeedEntry, version: string, now: number): Promise<void> {
  await db.entries.update(targetId, {
    lemma: s.lemma,
    pos: s.pos,
    features: s.gender ? { gender: s.gender } : {},
    inflections: s.inflections ?? {},
    pronunciation: s.ipa ? { ipa: s.ipa, ipaSource: 'wiktionary', ...(s.ipaAmbiguous ? { ambiguous: true } : {}) } : {},
    cefr: s.cefr,
    subDefinitions: s.subDefinitions,
    examples: s.examples,
    seedVersion: version,
    seedKey: s.seedKey,
    seedHash: s.h,
    updatedAt: now,
  })
  const tr = await db.translations.where('targetEntryId').equals(targetId).first()
  if (tr) await db.entries.update(tr.nativeEntryId, { lemma: s.translation, pos: s.pos, seedVersion: version, updatedAt: now })
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

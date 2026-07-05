import Dexie, { type EntityTable, type Table } from 'dexie'
import type {
  ActiveDrillSession,
  ActiveSessionRecord,
  DrillSessionLog,
  DrillStat,
  DrillType,
  Entry,
  EntryOverlay,
  IpaDictRecord,
  MetaRecord,
  Profile,
  ReviewState,
  SessionLog,
  Translation,
  WiktionaryCacheRecord,
} from './types'

// Dexie schema. Indices roughly per SPEC §4.7. The `study` tri-state is not indexed —
// session composition scans a whole language anyway.
export class YakDB extends Dexie {
  entries!: EntityTable<Entry, 'id'>
  entryOverlays!: EntityTable<EntryOverlay, 'id'>
  translations!: EntityTable<Translation, 'id'>
  reviewStates!: EntityTable<ReviewState, 'id'>
  profiles!: EntityTable<Profile, 'id'>
  sessionLogs!: EntityTable<SessionLog, 'id'>
  ipaDicts!: EntityTable<IpaDictRecord, 'lang'>
  wiktionaryCache!: EntityTable<WiktionaryCacheRecord, 'key'>
  meta!: EntityTable<MetaRecord, 'key'>
  activeSessions!: EntityTable<ActiveSessionRecord, 'id'>
  // Practice+ drills. `drillStats` has a compound primary key [entryId+drill]; the other two are
  // singleton / ULID-keyed like their practice counterparts.
  drillStats!: Table<DrillStat, [string, DrillType]>
  activeDrillSessions!: EntityTable<ActiveDrillSession, 'id'>
  drillSessionLogs!: EntityTable<DrillSessionLog, 'id'>

  constructor() {
    super('yak')
    // Note: entryOverlays uses `id, &entryId` (not SPEC §4.7's `id, entryId, &entryId`,
    // which defines the entryId index twice and makes IndexedDB throw on open). One overlay
    // per entry (§4.2), so the unique index alone is correct and queryable.
    this.version(1).stores({
      entries: 'id, lang, lemma, [lang+lemma], pos, source, cefr, userFlagged',
      entryOverlays: 'id, &entryId',
      translations: 'id, targetEntryId, nativeEntryId',
      reviewStates: 'id, translationId, skill, [translationId+skill], due, state',
      profiles: 'id, active, [learnerLang+targetLang]',
      sessionLogs: 'id, profileId, startedAt',
    })
    // v2: collapse userFlagged + hidden into a single `study` tri-state (SPEC §7.5).
    this.version(2)
      .stores({
        entries: 'id, lang, lemma, [lang+lemma], pos, source, cefr',
        entryOverlays: 'id, &entryId',
        translations: 'id, targetEntryId, nativeEntryId',
        reviewStates: 'id, translationId, skill, [translationId+skill], due, state',
        profiles: 'id, active, [learnerLang+targetLang]',
        sessionLogs: 'id, profileId, startedAt',
      })
      .upgrade((tx) =>
        tx
          .table('entries')
          .toCollection()
          .modify((e: Record<string, unknown>) => {
            e.study = e.hidden ? 'skip' : e.userFlagged ? 'always' : 'auto'
            delete e.userFlagged
            delete e.hidden
          }),
      )
    // v3: runtime-enrichment caches (ipa-dict per language, Wiktionary per word). (SPEC §10)
    this.version(3).stores({
      entries: 'id, lang, lemma, [lang+lemma], pos, source, cefr',
      entryOverlays: 'id, &entryId',
      translations: 'id, targetEntryId, nativeEntryId',
      reviewStates: 'id, translationId, skill, [translationId+skill], due, state',
      profiles: 'id, active, [learnerLang+targetLang]',
      sessionLogs: 'id, profileId, startedAt',
      ipaDicts: 'lang',
      wiktionaryCache: 'key, lang',
    })
    // v4: small key→value meta store. Holds the seed version the DB has been synced to, so the
    // startup gate can skip the 2.2MB seed fetch/parse when nothing changed. (Unspecified tables are
    // inherited from v3; the new store is created empty, no data migration needed.)
    this.version(4).stores({ meta: 'key' })
    // v5: persisted in-progress session, so a page refresh resumes the same queue/position instead
    // of recomposing. Singleton keyed by id ('active'). Created empty; no data migration needed.
    this.version(5).stores({ activeSessions: 'id' })
    // v6: multi-meaning words — a target word may link to several native meanings, each its own
    // scheduled card. Translation gains meaningKey + primary (see types.ts). No index change (the
    // composer scans a whole language anyway); existing single links become the primary (meaningKey 0).
    this.version(6).upgrade((tx) =>
      tx
        .table('translations')
        .toCollection()
        .modify((t: Record<string, unknown>) => {
          t.meaningKey = 0
          t.primary = true
        }),
    )
    // Note: Translation later gained two optional, non-indexed fields — `gloss` (a promoted meaning's
    // production hint, §12) and `senseKey` (a promoted meaning's production-grouping key, §12 grouping
    // follow-up). No version bump — Dexie stores whole objects, so old rows simply lack them (reads
    // fall back to entry.sense.{gloss,key}), and seed-sync repopulates them on the next shipped seed
    // update (the change flips the seed version → updateSeedTarget writes them).
    //
    // v7: per-sense examples (§4.8) changed Entry.examples from `string[]` to `{text, meaningKey}[]`,
    // and every reader now uses `.text`/`.meaningKey`. A fresh seed load converts legacy strings, but
    // changed-only seed-sync only rewrites a word when its content hash changes — so a word whose text
    // was unchanged in that release keeps its examples as bare strings, which the new readers can't
    // read (`.meaningKey` is undefined → production filters them out; `.text` is undefined → recognition
    // and Word Detail render blanks). That is a stored-shape change, not a content change, so it must
    // migrate here rather than via seed-sync. Rewrite every entry's examples to the tagged shape: a
    // legacy string becomes `{text, meaningKey: 0}` (pre-per-sense, all examples were the word's =
    // primary); already-migrated objects are left untouched.
    this.version(7).upgrade((tx) =>
      tx
        .table('entries')
        .toCollection()
        .modify((e: Record<string, unknown>) => {
          if (Array.isArray(e.examples)) {
            e.examples = e.examples.map((x) => (typeof x === 'string' ? { text: x, meaningKey: 0 } : x))
          }
        }),
    )
    // v8: Practice+ drills (grammar exercises, no FSRS). Three new stores, created empty — no data
    // migration. `drillStats` keys on [entryId+drill] and also indexes `drill` (for mastery counts);
    // `drillSessionLogs` indexes `drill` for the hub's "recent form" lookup; the active session is a
    // singleton keyed by id. (drills)
    this.version(8).stores({
      drillStats: '[entryId+drill], drill',
      activeDrillSessions: 'id',
      drillSessionLogs: 'id, drill',
    })
  }
}

export const db = new YakDB()

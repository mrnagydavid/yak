import Dexie, { type EntityTable } from 'dexie'
import type {
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
  }
}

export const db = new YakDB()

import Dexie, { type EntityTable } from 'dexie'
import type {
  Entry,
  EntryOverlay,
  Profile,
  ReviewState,
  SessionLog,
  Translation,
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
  }
}

export const db = new YakDB()

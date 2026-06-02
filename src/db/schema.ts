import Dexie, { type EntityTable } from 'dexie'
import type {
  Entry,
  EntryOverlay,
  Profile,
  ReviewState,
  SessionLog,
  Translation,
} from './types'

// Dexie schema, version 1. Indices per SPEC §4.7.
//
// Note: `userFlagged` is listed as an index per the spec, but IndexedDB does not
// index boolean values — only rows where the key path resolves to a valid key are
// indexed. Querying that index won't return `false`/`undefined` rows. Revisit if we
// need to query flagged entries by index (e.g. store 1/0 instead). For now we follow
// the spec and filter in memory where needed.
export class YakDB extends Dexie {
  entries!: EntityTable<Entry, 'id'>
  entryOverlays!: EntityTable<EntryOverlay, 'id'>
  translations!: EntityTable<Translation, 'id'>
  reviewStates!: EntityTable<ReviewState, 'id'>
  profiles!: EntityTable<Profile, 'id'>
  sessionLogs!: EntityTable<SessionLog, 'id'>

  constructor() {
    super('yak')
    this.version(1).stores({
      entries: 'id, lang, lemma, [lang+lemma], pos, source, cefr, userFlagged',
      entryOverlays: 'id, entryId, &entryId',
      translations: 'id, targetEntryId, nativeEntryId',
      reviewStates: 'id, translationId, skill, [translationId+skill], due, state',
      profiles: 'id, active, [learnerLang+targetLang]',
      sessionLogs: 'id, profileId, startedAt',
    })
  }
}

export const db = new YakDB()

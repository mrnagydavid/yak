import { db } from './schema'
import type { Entry, EntryOverlay, Profile, ReviewState, SessionLog, Translation } from './types'

// Export / import / clear of all local data. (SPEC §7.6)

export interface ExportBundle {
  app: 'yak'
  format: 1
  exportedAt: number
  entries: Entry[]
  entryOverlays: EntryOverlay[]
  translations: Translation[]
  reviewStates: ReviewState[]
  profiles: Profile[]
  sessionLogs: SessionLog[]
}

const TABLES = [
  'entries',
  'entryOverlays',
  'translations',
  'reviewStates',
  'profiles',
  'sessionLogs',
] as const

export async function exportData(): Promise<ExportBundle> {
  const [entries, entryOverlays, translations, reviewStates, profiles, sessionLogs] = await Promise.all([
    db.entries.toArray(),
    db.entryOverlays.toArray(),
    db.translations.toArray(),
    db.reviewStates.toArray(),
    db.profiles.toArray(),
    db.sessionLogs.toArray(),
  ])
  return { app: 'yak', format: 1, exportedAt: Date.now(), entries, entryOverlays, translations, reviewStates, profiles, sessionLogs }
}

export function isExportBundle(value: unknown): value is ExportBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { app?: unknown }).app === 'yak' &&
    Array.isArray((value as { entries?: unknown }).entries)
  )
}

/** Import a bundle — `replace` wipes existing data first; `merge` upserts by id. */
export async function importData(bundle: ExportBundle, mode: 'merge' | 'replace'): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    if (mode === 'replace') await Promise.all(TABLES.map((t) => db.table(t).clear()))
    await db.entries.bulkPut(bundle.entries ?? [])
    await db.entryOverlays.bulkPut(bundle.entryOverlays ?? [])
    await db.translations.bulkPut(bundle.translations ?? [])
    await db.reviewStates.bulkPut(bundle.reviewStates ?? [])
    await db.profiles.bulkPut(bundle.profiles ?? [])
    await db.sessionLogs.bulkPut(bundle.sessionLogs ?? [])
    // Drop the seed-version marker: imported entries may be from an older seed, so force the next
    // startup to re-sync against the served seed (changed-only, so it's cheap).
    await db.meta.clear()
  })
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(TABLES.map((t) => db.table(t).clear()))
    await db.meta.clear()
  })
}

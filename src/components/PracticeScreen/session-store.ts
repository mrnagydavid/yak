// The active practice session, held in two layers (SPEC §7.2 — a session is a snapshot for the
// sitting, not recomposed mid-session):
//
//   1. An in-memory module-level cache (`active`). preact-router unmounts the Practice route when
//      you switch tabs, so component state alone restarted the session (new queue, back to card 1)
//      on return. This cache makes tab-switch resume instant and synchronous.
//   2. An IndexedDB write-through backup (`activeSessions` table). The in-memory cache dies with the
//      JS context on a page refresh, which reset the progress bar and re-served the same words. The
//      persisted record survives the refresh; PracticeScreen reads it only when the in-memory cache
//      is empty and re-resolves its lightweight `SessionCard[]` back into views.
import type { PracticeCardView } from '../../db/queries'
import { getActiveProfile } from '../../db/queries'
import { db } from '../../db/schema'
import type { ActiveSessionRecord } from '../../db/types'
import type { SessionCard } from '../../srs/session-composer'

export interface ActiveSession {
  dayKey: string
  views: PracticeCardView[]
  index: number
  canPushFurther: boolean
}

/** Singleton key for the persisted session — only one is active at a time. */
const ACTIVE_ID = 'active'

/** Local calendar day. A new day means new due cards, so the session recomposes rather than resumes. */
export function dayKey(ts: number = Date.now()): string {
  return new Date(ts).toDateString()
}

let active: ActiveSession | null = null

/** The session to resume, or null if there's none for today (the caller should then compose one). */
export function resumableSession(now: number = Date.now()): ActiveSession | null {
  if (active && active.dayKey === dayKey(now)) return active
  active = null // stale (previous day) — drop it
  return null
}

export function saveSession(session: ActiveSession): void {
  active = session
}

/** Persist the cursor as the user advances, so leaving mid-session resumes in place. */
export function setSessionIndex(index: number): void {
  if (active) active.index = index
}

export function clearSession(): void {
  active = null
}

// --- IndexedDB persistence (refresh recovery) -------------------------------------------------
// These are additive and kept out of the synchronous in-memory functions above, so the sync API
// (and its tests) stay synchronous. PracticeScreen calls both layers explicitly.

/** Pure check: may this persisted record be resumed now? Same profile and same local day. */
export function isResumableRecord(
  rec: ActiveSessionRecord | undefined,
  profileId: string,
  now: number = Date.now(),
): boolean {
  return !!rec && rec.dayKey === dayKey(now) && rec.profileId === profileId
}

/** The persisted session to resume after a refresh, or null. Drops a stale (old-day/profile) row. */
export async function loadPersistedSession(
  now: number = Date.now(),
): Promise<ActiveSessionRecord | null> {
  const profile = await getActiveProfile()
  if (!profile) return null
  const rec = await db.activeSessions.get(ACTIVE_ID)
  if (isResumableRecord(rec, profile.id, now)) return rec ?? null
  if (rec) await db.activeSessions.delete(ACTIVE_ID) // stale — recompose
  return null
}

/** Write the whole session through to IndexedDB. Called at session start / push-further. */
export async function persistSession(
  cards: SessionCard[],
  index: number,
  canPushFurther: boolean,
  now: number = Date.now(),
): Promise<void> {
  const profile = await getActiveProfile()
  if (!profile) return
  await db.activeSessions.put({
    id: ACTIVE_ID,
    profileId: profile.id,
    dayKey: dayKey(now),
    cards,
    index,
    canPushFurther,
    updatedAt: now,
  })
}

/** Cheap cursor update as the user advances — no profile re-read. */
export async function persistIndex(index: number): Promise<void> {
  await db.activeSessions.update(ACTIVE_ID, { index, updatedAt: Date.now() })
}

export async function clearPersistedSession(): Promise<void> {
  await db.activeSessions.delete(ACTIVE_ID)
}

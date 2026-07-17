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
import type { ActiveSessionRecord, DailyLimits } from '../../db/types'
import {
  canPushFurtherFor,
  cardKey,
  extendLimits,
  reconcileLimits,
  type SessionCard,
  type SessionMaster,
  windowMaster,
} from '../../srs/session-composer'

export interface ActiveSession {
  dayKey: string
  views: PracticeCardView[]
  index: number
  canPushFurther: boolean
  // Carried so a tab-switch resume re-shows the "limits change tomorrow" banner until it's dismissed.
  limitChangeNotice?: boolean
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

/** Swap in freshly-resolved views (e.g. after an in-session edit) so a tab-switch resume reflects it. */
export function setSessionViews(views: PracticeCardView[]): void {
  if (active) active.views = views
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

/** Write the whole session through to IndexedDB. Called at session start. `extra` carries the frozen
 *  master + starting local limits + notice flag, so daily-limit changes can re-window later. */
export async function persistSession(
  cards: SessionCard[],
  index: number,
  canPushFurther: boolean,
  extra?: { master?: SessionMaster; localLimits?: DailyLimits; limitChangeNotice?: boolean },
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
    master: extra?.master,
    localLimits: extra?.localLimits,
    limitChangeNotice: extra?.limitChangeNotice ?? false,
    updatedAt: now,
  })
}

/** Cheap cursor update as the user advances — no profile re-read. */
export async function persistIndex(index: number): Promise<void> {
  await db.activeSessions.update(ACTIVE_ID, { index, updatedAt: Date.now() })
}

/** Partial write of the queue + cursor when a re-queue splices in a clone — preserves the frozen master
 *  / local limits / notice that a full `persistSession` would rewrite. */
export async function persistCards(cards: SessionCard[], index: number): Promise<void> {
  await db.activeSessions.update(ACTIVE_ID, { cards, index, updatedAt: Date.now() })
}

export async function clearPersistedSession(): Promise<void> {
  await db.activeSessions.delete(ACTIVE_ID)
}

// --- Live daily limits: re-window today's session on a change / push-further (SPEC §6.2, §7.7) -------

/**
 * Re-window today's live session after the Profile ("global") limits change: keep the consumed prefix
 * verbatim, rebuild the tail from the frozen master at the new local limits (per `reconcileLimits`),
 * cursor unchanged. A no-op when there's no resumable session today or it predates the master (older
 * record — can't be windowed, so it just recomposes on the next new day). Clears the in-memory snapshot
 * so Practice re-resolves the reconciled queue when the user returns from Profile.
 */
export async function reconcileActiveSession(
  prevGlobal: DailyLimits,
  nextGlobal: DailyLimits,
  now: number = Date.now(),
): Promise<void> {
  const profile = await getActiveProfile()
  if (!profile) return
  const rec = await db.activeSessions.get(ACTIVE_ID)
  if (!rec || !isResumableRecord(rec, profile.id, now) || !rec.master || !rec.localLimits) return

  const local = reconcileLimits(rec.localLimits, prevGlobal, nextGlobal)
  const prefix = rec.cards.slice(0, rec.index)
  const doneKeys = new Set(prefix.map(cardKey))
  const cards = [...prefix, ...windowMaster(rec.master, local, doneKeys)]
  const canPushFurther = canPushFurtherFor(local, nextGlobal, rec.master)
  // "Didn't land today" = today's session still runs above the new global for a budget (you're pushing
  // further), so the change only applies tomorrow — the Practice banner announces exactly this.
  const limitChangeNotice =
    local.newPerDay > nextGlobal.newPerDay || local.practicePerDay > nextGlobal.practicePerDay

  await db.activeSessions.update(ACTIVE_ID, {
    cards,
    localLimits: local,
    canPushFurther,
    limitChangeNotice,
    updatedAt: now,
  })
  clearSession() // drop the in-memory snapshot; Practice re-resolves from the reconciled record on return
}

/**
 * Widen today's limits by one more day's worth and reveal the next slice of the frozen master, capped at
 * its size (SPEC §7.7). Returns the new queue + cursor for the caller to resolve into views, or null when
 * there's nothing more to pull. Keeps the consumed prefix and the cursor, so the freshly revealed cards
 * land right where you'd got to.
 */
export async function pushFurtherSession(
  now: number = Date.now(),
): Promise<{ cards: SessionCard[]; index: number; canPushFurther: boolean } | null> {
  const profile = await getActiveProfile()
  if (!profile) return null
  const rec = await db.activeSessions.get(ACTIVE_ID)
  if (!rec || !isResumableRecord(rec, profile.id, now) || !rec.master || !rec.localLimits) return null

  const global = profile.dailyLimits
  const local = extendLimits(rec.localLimits, global, rec.master)
  if (local.newPerDay === rec.localLimits.newPerDay && local.practicePerDay === rec.localLimits.practicePerDay) {
    return null // already at the master's edge — nothing more to reveal
  }
  const prefix = rec.cards.slice(0, rec.index)
  const doneKeys = new Set(prefix.map(cardKey))
  const cards = [...prefix, ...windowMaster(rec.master, local, doneKeys)]
  const canPushFurther = canPushFurtherFor(local, global, rec.master)
  await db.activeSessions.update(ACTIVE_ID, { cards, localLimits: local, canPushFurther, updatedAt: now })
  return { cards, index: rec.index, canPushFurther }
}

/** Dismiss the "limits change tomorrow" banner — stays dismissed until the next diverging change re-sets
 *  it. Clears both layers so neither a tab switch nor a refresh re-shows it. */
export async function dismissLimitNotice(): Promise<void> {
  if (active) active.limitChangeNotice = false
  await db.activeSessions.update(ACTIVE_ID, { limitChangeNotice: false, updatedAt: Date.now() })
}

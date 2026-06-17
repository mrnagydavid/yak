// The active practice session, held outside the component lifecycle. preact-router unmounts the
// Practice route when you switch tabs, so keeping the session in component state restarted it (new
// queue, back to card 1) on return. This module-level store lets PracticeScreen resume the same
// queue and position; it recomposes only when there's no session for the current day.
// (SPEC §7.2 — a session is a snapshot for the sitting, not recomposed mid-session.)
import type { PracticeCardView } from '../../db/queries'

export interface ActiveSession {
  dayKey: string
  views: PracticeCardView[]
  index: number
  canPushFurther: boolean
}

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

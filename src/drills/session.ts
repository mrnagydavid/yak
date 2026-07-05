import { getActiveProfile } from '../db/queries'
import { ulid } from '../db/ids'
import { db } from '../db/schema'
import type { ActiveDrillSession, DrillSessionLog, DrillStat, DrillType, Entry } from '../db/types'
import { getRenderer } from '../lang'
import { isSolid, nextBox } from './box'
import { type DrillCandidate, DRILL_BATCH_SIZE, pickBatch } from './picker'
import { drillsForLanguage, getDrillMeta } from './registry'
import { insertRequeue } from './requeue'
import type { DrillMeta, DrillQuestion } from './types'

// Language-agnostic Practice+ session lifecycle over Dexie. Deliberately separate from the FSRS
// practice pipeline: no due dates, no scheduler — a frozen batch + a per-word box, updated as the
// learner answers. Per-drill eligibility comes from the registry; question resolution is generic.

const ACTIVE_ID = 'active'

/** Mastery + recent-form summary for a drill, shown on its hub box. */
export interface DrillOverview {
  eligible: number // words the learner could be drilled on
  seen: number // of those, how many have been attempted at least once
  solid: number // of those, how many are mastered (box ≥ SOLID_BOX)
  lastSession: DrillSessionLog | null
}

/** One drill's hub row: its metadata plus its current overview. */
export interface DrillHubItem {
  meta: DrillMeta
  overview: DrillOverview
}

/** Entry ids the learner has MET — the word's primary (recognition) card has been reviewed at least
 *  once. That's the gate for every drill: you drill grammar of words you've started learning. */
async function metEntryIds(entries: Entry[]): Promise<Set<string>> {
  const trs = await db.translations
    .where('targetEntryId')
    .anyOf(entries.map((e) => e.id))
    .toArray()
  const entryByPrimaryTr = new Map<string, string>() // primary translationId → target entryId
  for (const t of trs) if (t.primary) entryByPrimaryTr.set(t.id, t.targetEntryId)
  const states = await db.reviewStates
    .where('translationId')
    .anyOf([...entryByPrimaryTr.keys()])
    .toArray()
  const met = new Set<string>()
  for (const rs of states) {
    if (rs.skill !== 'recognize' || rs.reps < 1) continue
    const entryId = entryByPrimaryTr.get(rs.translationId)
    if (entryId) met.add(entryId)
  }
  return met
}

/** The words currently eligible for a drill in the given target language (delegates to the drill's
 *  own eligibility rule from the registry). */
async function eligibleEntries(type: DrillType, targetLang: string): Promise<Entry[]> {
  const meta = getDrillMeta(type)
  if (!meta) return []
  const entries = await db.entries.where('lang').equals(targetLang).toArray()
  const met = await metEntryIds(entries)
  return entries.filter((e) => meta.eligible(e, met.has(e.id)))
}

/** Current box per entry for a drill (missing rows mean unseen). */
async function statsByEntry(type: DrillType, entryIds: string[]): Promise<Map<string, DrillStat>> {
  const rows = await db.drillStats
    .where('[entryId+drill]')
    .anyOf(entryIds.map((id) => [id, type] as [string, DrillType]))
    .toArray()
  return new Map(rows.map((r) => [r.entryId, r]))
}

/**
 * Start a drill: compose a frozen batch weighted by the box model, persist it as the singleton active
 * session, and return it. Returns null when nothing is eligible (the hub keeps Start hidden then).
 * `rng` is injectable for deterministic tests.
 */
export async function startDrillSession(
  type: DrillType,
  now: number = Date.now(),
  rng: () => number = Math.random,
): Promise<ActiveDrillSession | null> {
  const profile = await getActiveProfile()
  if (!profile) return null
  const entries = await eligibleEntries(type, profile.targetLang)
  if (entries.length === 0) return null
  const stats = await statsByEntry(type, entries.map((e) => e.id))
  const candidates: DrillCandidate[] = entries.map((e) => ({ entryId: e.id, box: stats.get(e.id)?.box ?? 0 }))
  const queue = pickBatch(candidates, DRILL_BATCH_SIZE, rng)
  const session: ActiveDrillSession = {
    id: ACTIVE_ID,
    profileId: profile.id,
    drill: type,
    queue,
    index: 0,
    initialCount: queue.length,
    cleared: [],
    missed: [],
    startedAt: now,
    updatedAt: now,
  }
  await db.activeDrillSessions.put(session)
  return session
}

/** The sticky in-progress session to resume, or null. Drops a session left over from another profile
 *  (its queue is for a different language). No day gate — a drill persists until manually finished. */
export async function getActiveDrillSession(): Promise<ActiveDrillSession | null> {
  const profile = await getActiveProfile()
  if (!profile) return null
  const rec = await db.activeDrillSessions.get(ACTIVE_ID)
  if (!rec) return null
  // Drop a session for a different profile (its queue is for another language) or one written by an
  // older build that predates the "clear the board" fields (missing `initialCount`) — resuming that
  // shape would divide by undefined. Either way, a stale in-progress drill is safe to discard.
  if (rec.profileId !== profile.id || rec.initialCount === undefined) {
    await db.activeDrillSessions.delete(ACTIVE_ID)
    return null
  }
  return rec
}

/**
 * Record one answer: promote/reset the word's box (live, so an early exit still counts it), advance
 * the cursor, and — on a miss — re-queue the word a few cards later so it returns until cleared.
 * Persists both the stat and the session in one transaction. Returns the updated session so the caller
 * can drive the UI without re-reading.
 */
export async function recordDrillAnswer(
  session: ActiveDrillSession,
  entryId: string,
  correct: boolean,
  now: number = Date.now(),
): Promise<ActiveDrillSession> {
  const nextIndex = session.index + 1
  const updated: ActiveDrillSession = {
    ...session,
    index: nextIndex,
    // Right → the word leaves the board (cleared). Wrong → it stays on the board and gets spliced back
    // in a few cards later. Both `cleared`/`missed` are de-duplicated sets of distinct entryIds.
    queue: correct ? session.queue : insertRequeue(session.queue, nextIndex, entryId),
    cleared: correct && !session.cleared.includes(entryId) ? [...session.cleared, entryId] : session.cleared,
    missed: !correct && !session.missed.includes(entryId) ? [...session.missed, entryId] : session.missed,
    updatedAt: now,
  }
  await db.transaction('rw', db.drillStats, db.activeDrillSessions, async () => {
    const prev = await db.drillStats.get([entryId, session.drill])
    const stat: DrillStat = {
      entryId,
      drill: session.drill,
      box: nextBox(prev?.box ?? 0, correct),
      seen: (prev?.seen ?? 0) + 1,
      lastResult: correct ? 'pass' : 'fail',
      lastSeenAt: now,
    }
    await db.drillStats.put(stat)
    await db.activeDrillSessions.put(updated)
  })
  return updated
}

/** Finish a session (naturally or via early exit): write the log and clear the active record. */
export async function endDrillSession(
  session: ActiveDrillSession,
  endedEarly: boolean,
  now: number = Date.now(),
): Promise<DrillSessionLog> {
  // First-try = cleared words that were never missed. At a natural finish every word is cleared, so
  // this is the honest skill readout; on an early exit it reflects only what got cleared.
  const firstTry = session.cleared.filter((id) => !session.missed.includes(id)).length
  const log: DrillSessionLog = {
    id: ulid(now),
    profileId: session.profileId,
    drill: session.drill,
    startedAt: session.startedAt,
    endedAt: now,
    words: session.initialCount,
    cleared: session.cleared.length,
    firstTry,
    attempts: session.index,
    endedEarly,
  }
  await db.transaction('rw', db.drillSessionLogs, db.activeDrillSessions, async () => {
    await db.drillSessionLogs.add(log)
    await db.activeDrillSessions.delete(ACTIVE_ID)
  })
  return log
}

/** Resolve a frozen queue of entry ids into displayable questions (target word + native gloss), in
 *  order. Any entry that no longer exists is skipped. Drill-agnostic. */
export async function resolveDrillQuestions(entryIds: string[]): Promise<DrillQuestion[]> {
  const entries = (await db.entries.bulkGet(entryIds)).filter((e): e is Entry => !!e)
  const byId = new Map(entries.map((e) => [e.id, e]))
  const trs = await db.translations
    .where('targetEntryId')
    .anyOf(entries.map((e) => e.id))
    .toArray()
  const nativeIdByEntry = new Map<string, string>()
  for (const t of trs) if (t.primary) nativeIdByEntry.set(t.targetEntryId, t.nativeEntryId)
  const natives = (await db.entries.bulkGet([...new Set(nativeIdByEntry.values())])).filter(
    (e): e is Entry => !!e,
  )
  const nativeById = new Map(natives.map((e) => [e.id, e]))

  const questions: DrillQuestion[] = []
  for (const id of entryIds) {
    const entry = byId.get(id)
    if (!entry) continue
    const nativeId = nativeIdByEntry.get(id)
    const native = nativeId ? nativeById.get(nativeId) : undefined
    questions.push({ entry, gloss: native ? getRenderer(native.lang).renderLemma(native) : '—' })
  }
  return questions
}

/** Compute a drill's mastery + recent form. */
async function computeOverview(type: DrillType, targetLang: string): Promise<DrillOverview> {
  const entries = await eligibleEntries(type, targetLang)
  const stats = await statsByEntry(type, entries.map((e) => e.id))
  let seen = 0
  let solid = 0
  for (const e of entries) {
    const s = stats.get(e.id)
    if (!s) continue
    seen++
    if (isSolid(s.box)) solid++
  }
  const logs = await db.drillSessionLogs.where('drill').equals(type).toArray()
  const lastSession = logs.length ? logs.reduce((a, b) => (a.endedAt >= b.endedAt ? a : b)) : null
  return { eligible: entries.length, seen, solid, lastSession }
}

/** Mastery + recent form for one drill's hub box. */
export async function getDrillOverview(type: DrillType): Promise<DrillOverview | null> {
  const profile = await getActiveProfile()
  if (!profile) return null
  return computeOverview(type, profile.targetLang)
}

/** All drills for the active profile's target language, each with its overview — drives the hub. */
export async function getDrillHub(): Promise<DrillHubItem[]> {
  const profile = await getActiveProfile()
  if (!profile) return []
  const metas = drillsForLanguage(profile.targetLang)
  const items: DrillHubItem[] = []
  for (const meta of metas) {
    items.push({ meta, overview: await computeOverview(meta.type, profile.targetLang) })
  }
  return items
}

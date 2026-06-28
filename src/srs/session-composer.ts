import { db } from '../db/schema'
import { getActiveProfile } from '../db/queries'
import type { Entry, Profile, ReviewState, Skill, Translation } from '../db/types'
import { applyRating, createReviewState, type RatingLabel } from './fsrs-adapter'
import { cefrRank, levelRank } from './levels'

// Composes a daily study session from the active profile's study set. (SPEC §6.1–6.3)
//
// MODELLING DECISIONS (open questions per SPEC §13 — flag for confirmation):
//
// 1. The reviewable unit ("card") is a (translation, skill) pair, matching the data model
//    (ReviewState is per translation+skill, and §4.4 says the two skills evolve
//    independently). So `newPerDay` / `practicePerDay` count translation-skill cards.
//    Production is GATED behind recognition (see below), so early on each new word yields
//    a single recognition card; production trickles in later as the word is half-known.
//
// 1b. PRODUCTION GATING (confirmed design decision). The `produce` direction for a
//    translation does not become eligible until its sibling `recognize` direction has
//    graduated out of learning AND stabilised (recognition-before-production; avoids the
//    "free" same-session reverse). It is ALSO held back on any day recognition is itself
//    due — a session never asks both directions of the same word, since doing the reverse
//    right after the recognition reveal is wasted effort; it slots into a later, naturally-
//    spaced session instead. Once a `produce` ReviewState exists it is independent and never
//    re-locks (two long-known directions may both come due together). Threshold is
//    `PRODUCTION_UNLOCK_*` below (could become a Profile setting later). This gate
//    INTENTIONALLY also covers below-level calibration words: for a word the user
//    overclaimed, showing production right after the recognition reveal would be the same
//    trivial reverse; gating defers it to a later session. For words the user does know,
//    recognition graduates on one "Easy", unlocking production on a later encounter.
//
// 2. A no-SRS card is classified by the entry's CEFR relative to the claimed level:
//      - seed entry with cefr <= UserLevel        → calibration candidate → practice pool,
//        shown review-style (SPEC §6.3); rating creates initial state
//      - cefr == UserLevel+1, or user-added / study==='always' → new pool (new-card mode)
//    This reconciles §6.1 (practice = has-SRS) with §6.3 (calibrate <=level on encounter).
//    The calibration backlog can be huge (every band at-or-below level, with no SRS state
//    on a freshly-levelled profile), so it is surfaced as a weighted proximity mix: each
//    session is mostly the user's own band with a thinner tail of lower bands, rather than
//    grinding through the lowest band first. See `calibrationWeight` / the practice sort.
//
// 3. Practice cards with SRS state are only included when due (due <= now); not-yet-due
//    cards surface on the day they come due. (Drives the all-caught-up screen, §7.7.)

export type CardMode = 'new' | 'practice'

export interface SessionCard {
  translationId: string
  targetEntryId: string
  skill: Skill
  mode: CardMode
  /** Present for cards that already have FSRS state (i.e. genuine practice cards). */
  reviewState?: ReviewState
}

const SKILLS: Skill[] = ['recognize', 'produce']

// Production unlocks once recognition has graduated out of learning and stuck for ~a week.
const PRODUCTION_UNLOCK_STABILITY_DAYS = 7

/** Whether the produce direction may be introduced, given the sibling recognise state. */
function productionUnlocked(recognize?: ReviewState): boolean {
  return (
    !!recognize &&
    recognize.state === 'review' &&
    recognize.stability >= PRODUCTION_UNLOCK_STABILITY_DAYS
  )
}

// FNV-1a 32-bit hash + murmur3 avalanche → [0, 1). Gives calibration candidates a
// stable-per-day but day-to-day-varying value. The avalanche finalizer matters: near-
// identical inputs (`dayStart:id` for sequential ids) leave FNV's output clustered, which
// would bias the weighted proximity draw; fmix32 decorrelates it to ~uniform.
function hash01(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // murmur3 fmix32 finalizer
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// How fast a calibration band's share of the session decays per CEFR step below the
// claimed level. 0.5 → each step down gets half the weight of the one above, so the mix is
// scale-invariant: the user's own band ≈ half the calibration slots, the next ≈ a quarter,
// and so on (at B1, B1:A2:A1 ≈ 4:2:1). Lower bands stay represented but thin, never starved.
const CALIBRATION_BAND_DECAY = 0.5

/** Sampling weight for a calibration candidate `distance` CEFR steps below the claim. */
function calibrationWeight(distance: number): number {
  return CALIBRATION_BAND_DECAY ** distance
}

type Band = 'new' | 'calibration' | 'ineligible'

/** Classify an entry's no-SRS band relative to the claimed level. (SPEC §6.1–6.3) */
function bandOf(entry: Entry, lr: number): Band {
  if (entry.study === 'skip') return 'ineligible'
  if (entry.source === 'seed' && cefrRank(entry.cefr) <= lr) return 'calibration'
  const progression = entry.source === 'seed' && cefrRank(entry.cefr) <= lr + 1
  if (entry.study === 'always' || entry.source === 'user' || progression) return 'new'
  return 'ineligible'
}

export interface ComposerInput {
  now: number
  /** Local midnight for `now` — boundary for "introduced today" budgeting. */
  dayStart: number
  level: Profile['claimedLevel']
  limits: Profile['dailyLimits']
  entries: Entry[] // target-language entries
  translations: Translation[] // translations whose targetEntryId is one of `entries`
  reviewStates: ReviewState[] // review states for those translations
  /** "Push further" (SPEC §7.7) — ignore today's already-introduced count. */
  pushFurther?: boolean
}

interface Candidate {
  card: SessionCard
  entry: Entry
  // priority hints for the new pool
  userAdded: boolean
  forced: boolean // study === 'always'
  // per-day shuffle key for calibration candidates (within a CEFR band)
  calibrationKey?: number
}

/** Pure session composition over already-loaded data. */
export function composeSessionPure(input: ComposerInput): SessionCard[] {
  const { now, dayStart, level, limits } = input
  const lr = levelRank(level)

  const entryById = new Map(input.entries.map((e) => [e.id, e]))
  const entryByTranslation = new Map<string, Entry>()
  for (const t of input.translations) {
    const e = entryById.get(t.targetEntryId)
    if (e) entryByTranslation.set(t.id, e)
  }
  const rsByKey = new Map<string, ReviewState>()
  for (const rs of input.reviewStates) {
    rsByKey.set(`${rs.translationId}:${rs.skill}`, rs)
  }

  // New cards already introduced today (any new-band card whose SRS state was first
  // created since local midnight). Subtracted from the daily budget so reopening the app
  // mid-day doesn't hand out a fresh batch. "Push further" ignores this. (SPEC §6.2, §7.7)
  let newDoneToday = 0
  if (!input.pushFurther) {
    for (const rs of input.reviewStates) {
      if (rs.createdAt < dayStart) continue
      const e = entryByTranslation.get(rs.translationId)
      if (e && bandOf(e, lr) === 'new') newDoneToday += 1
    }
  }
  const newBudget = Math.max(0, limits.newPerDay - newDoneToday)

  const practice: Candidate[] = []
  const fresh: Candidate[] = []

  for (const translation of input.translations) {
    const entry = entryById.get(translation.targetEntryId)
    // `skip` is the manual exclude (replaces the old `hidden`) — never enters a session.
    if (!entry || entry.study === 'skip') continue

    const userAdded = entry.source === 'user'
    const forced = entry.study === 'always'
    const progression = entry.source === 'seed' && cefrRank(entry.cefr) <= lr + 1

    for (const skill of SKILLS) {
      const rs = rsByKey.get(`${translation.id}:${skill}`)

      // Production is gated behind recognition until it has its own state (SPEC §6, 1b).
      if (skill === 'produce' && !rs) {
        const rec = rsByKey.get(`${translation.id}:recognize`)
        if (!productionUnlocked(rec)) continue // recognition not stabilised yet
        if (rec && rec.due <= now) continue // ...and recognition isn't itself due today —
        // defer the reverse to a naturally-spaced later session (no both-directions-in-one-day)
      }

      const eligible = forced || userAdded || !!rs || progression
      if (!eligible) continue

      const card: SessionCard = {
        translationId: translation.id,
        targetEntryId: entry.id,
        skill,
        mode: 'new',
        reviewState: rs,
      }

      if (rs) {
        // Genuine practice card — only when due.
        if (rs.due <= now) practice.push({ card: { ...card, mode: 'practice' }, entry, userAdded, forced })
      } else if (entry.source === 'seed' && cefrRank(entry.cefr) <= lr) {
        // Calibration candidate — no SRS state yet, but practiced review-style (SPEC §6.3).
        // Weighted per-day key (Efraimidis–Spirakis `u^(1/w)`, larger = earlier): near-level
        // bands get a higher weight and dominate, lower bands form a thin tail. (SPEC §6.3)
        const distance = lr - cefrRank(entry.cefr)
        const u = hash01(`${dayStart}:${entry.id}`)
        practice.push({
          card: { ...card, mode: 'practice' },
          entry,
          userAdded,
          forced,
          calibrationKey: u ** (1 / calibrationWeight(distance)),
        })
      } else {
        fresh.push({ card, entry, userAdded, forced })
      }
    }
  }

  // Practice order: due SRS cards by due asc then lastReview asc; calibration candidates
  // (no SRS) after, by weighted per-day key descending — a proximity mix that favours the
  // user's own band with a thin tail of lower bands. (SPEC §6.2 step 2, §6.3)
  practice.sort((a, b) => {
    const ra = a.card.reviewState
    const rb = b.card.reviewState
    if (ra && rb) return ra.due - rb.due || (ra.lastReview ?? 0) - (rb.lastReview ?? 0)
    if (ra) return -1
    if (rb) return 1
    return (b.calibrationKey ?? 0) - (a.calibrationKey ?? 0)
  })

  // New order: user-added first, then force-studied (always), then progression
  // (cefr=level+1), each by createdAt asc. (SPEC §6.2 step 1)
  const newRank = (c: Candidate) => (c.userAdded ? 0 : c.forced ? 1 : 2)
  fresh.sort((a, b) => newRank(a) - newRank(b) || a.entry.createdAt - b.entry.createdAt)

  const practiceCards = practice.slice(0, limits.practicePerDay).map((c) => c.card)
  const newCards = fresh.slice(0, newBudget).map((c) => c.card)

  return interleave(practiceCards, newCards)
}

/** Front-load practice cards and sprinkle new cards in at regular intervals. (SPEC §6.2 step 3) */
function interleave(practice: SessionCard[], news: SessionCard[]): SessionCard[] {
  if (news.length === 0) return practice
  if (practice.length === 0) return news

  const out: SessionCard[] = []
  const gap = Math.max(1, Math.floor(practice.length / news.length))
  let n = 0
  for (let i = 0; i < practice.length; i++) {
    out.push(practice[i])
    if ((i + 1) % gap === 0 && n < news.length) out.push(news[n++])
  }
  while (n < news.length) out.push(news[n++])
  return out
}

/** Local midnight for a timestamp — the boundary for daily budgets. */
function startOfLocalDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Compose today's session for the active profile, loading from Dexie. */
export async function composeSession(
  now: number = Date.now(),
  pushFurther = false,
): Promise<SessionCard[]> {
  const profile = await getActiveProfile()
  if (!profile) return []

  const entries = await db.entries.where('lang').equals(profile.targetLang).toArray()
  const entryIds = entries.map((e) => e.id)
  const translations = await db.translations.where('targetEntryId').anyOf(entryIds).toArray()
  const translationIds = translations.map((t) => t.id)
  const reviewStates = await db.reviewStates.where('translationId').anyOf(translationIds).toArray()

  return composeSessionPure({
    now,
    dayStart: startOfLocalDay(now),
    level: profile.claimedLevel,
    limits: profile.dailyLimits,
    entries,
    translations,
    reviewStates,
    pushFurther,
  })
}

/** What `recordReview` wrote, enough for `undoReview` to reverse it exactly. */
export interface ReviewUndo {
  /** The pre-rating row to restore, or undefined if the rating created the row. */
  previous: ReviewState | undefined
  /** The id of the row `recordReview` wrote (the one to delete when there was no previous). */
  writtenId: string
}

/**
 * Apply a self-evaluation rating to a session card and persist the result. Creates the
 * initial FSRS state for new/calibration cards (those without one yet), or updates the
 * existing state for practice cards. Returns a token that `undoReview` can reverse, so an
 * accidental tap can be taken back within the sitting (SPEC §6.5).
 */
export async function recordReview(
  card: SessionCard,
  label: RatingLabel,
  now: number = Date.now(),
): Promise<ReviewUndo> {
  const previous = card.reviewState // undefined for new/calibration cards — no row existed yet
  const base = previous ?? createReviewState(card.translationId, card.skill, now)
  const next = applyRating(base, label, now)
  await db.reviewStates.put(next)
  return { previous, writtenId: next.id }
}

/**
 * Reverse a `recordReview`: restore the exact pre-rating row, or — if the rating created the
 * row (a card seen for the first time) — delete it so the word is unseen again. No FSRS math
 * is involved; the prior row is a verbatim snapshot, so the reversal is exact.
 */
export async function undoReview(undo: ReviewUndo): Promise<void> {
  if (undo.previous) await db.reviewStates.put(undo.previous)
  else await db.reviewStates.delete(undo.writtenId)
}

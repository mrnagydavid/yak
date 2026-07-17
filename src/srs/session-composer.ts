import { db } from '../db/schema'
import { getActiveProfile, getReviewState } from '../db/queries'
import type { DailyLimits, Entry, Profile, ReviewState, Skill, Translation } from '../db/types'
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
//    translation does not become eligible until the WORD's `recognize` direction has
//    graduated out of learning AND stabilised. The word's recognition lives on the primary
//    meaning (meaningKey 0); every meaning's production — primary or extra — gates behind that
//    one recognition (multi-meaning design). (recognition-before-production; avoids the
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
  /**
   * Present on a multi-answer PRODUCTION card: the taught sibling answers that share this answer's
   * sense (e.g. "clearly (in a clear way)" → tydligt, klart). The concept is asked once and graded
   * together; `translationId`/`targetEntryId`/`reviewState` above are the representative (earliest-due)
   * member, which drives the card's scheduling slot. (plan, SPEC §6)
   */
  group?: { members: { translationId: string; targetEntryId: string }[] }
}

const SKILLS: Skill[] = ['recognize', 'produce']

// The most a user can dial the daily limits up to — also the size the day's `master` pool is frozen
// at, so they double as the hard "Push further" ceiling: at most this many practice + new cards a day.
// Kept in sync with the Profile steppers (their `max`).
export const MAX_NEW_PER_DAY = 50
export const MAX_PRACTICE_PER_DAY = 500

/**
 * The full day's pool, frozen at first compose — the source the live daily limits window into. Practice
 * cards are already deduped/grouped and ordered (capped at MAX_PRACTICE_PER_DAY); new cards ordered
 * (capped at MAX_NEW_PER_DAY, minus any introduced earlier today). Serving `n` of a sub-queue always
 * means its first `n`, so a limit change / Push further only reveals or hides a suffix — the words seen
 * so far never change (that's what makes limit changes non-disruptive; SPEC §6.2).
 */
export interface SessionMaster {
  practice: SessionCard[]
  news: SessionCard[]
}

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
  const { practiceCards, newCards } = composeParts(input)
  return interleave(practiceCards, newCards)
}

/**
 * The ordered practice and new sub-queues for `input.limits`, BEFORE interleaving — the shared core of
 * `composeSessionPure` and the master builder (`buildMasterPure`). Returns `newDoneToday` (new cards
 * introduced earlier today) so a caller can budget the day's remaining introductions. Practice is capped
 * (and its production groups collapsed) at `limits.practicePerDay`; new at `newPerDay − newDoneToday`.
 */
function composeParts(input: ComposerInput): {
  practiceCards: SessionCard[]
  newCards: SessionCard[]
  newDoneToday: number
} {
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
  // Recognition is per WORD, carried by the primary meaning (meaningKey 0). Production of ANY meaning
  // gates behind the word's recognition, so map each word to its primary link. (multi-meaning design)
  const primaryTrByEntry = new Map<string, Translation>()
  for (const t of input.translations) {
    if (t.primary) primaryTrByEntry.set(t.targetEntryId, t)
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
      // Recognition is asked once per word, off the primary meaning — a non-primary meaning never
      // gets a recognition card (knowing the word means recognising *something*). (multi-meaning design)
      if (skill === 'recognize' && !translation.primary) continue

      const rs = rsByKey.get(`${translation.id}:${skill}`)

      // Production is gated behind the WORD's recognition (the primary meaning's recognize state) until
      // it has its own state (SPEC §6, 1b; multi-meaning design). For the primary meaning this is
      // unchanged; for an extra meaning it means "learn to recognise the word first, then its meanings".
      if (skill === 'produce' && !rs) {
        const primaryTr = primaryTrByEntry.get(entry.id)
        const rec = primaryTr ? rsByKey.get(`${primaryTr.id}:recognize`) : undefined
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

  // New order: user-added first, then force-studied (always), then progression (cefr=level+1). Within a
  // rank, higher `boost` first — the authored "initial boost" that front-loads high-value beginner vocab
  // so a below-A1 learner meets the good A1 words before the band's long tail (A1 boost pack). Then
  // seedKey asc as a stable, reproducible tiebreak (all seed entries share one createdAt, so createdAt
  // alone can't order them); createdAt last for user-added words, which have real distinct timestamps.
  // NOTE: boost only orders this NEW pool — practice (due asc) and the calibration mix (per-day shuffle)
  // are deliberately untouched, so a word's day-to-day order still varies once it has SRS state. (§6.2)
  const newRank = (c: Candidate) => (c.userAdded ? 0 : c.forced ? 1 : 2)
  fresh.sort(
    (a, b) =>
      newRank(a) - newRank(b) ||
      (b.entry.boost ?? 0) - (a.entry.boost ?? 0) ||
      (a.entry.seedKey ?? Infinity) - (b.entry.seedKey ?? Infinity) ||
      a.entry.createdAt - b.entry.createdAt,
  )

  // One direction per word per session (SPEC §278). If a word's recognition AND a production (its
  // own or a promoted meaning's) are both due today, don't ask both — the second is the trivial
  // reverse of the first, just revealed. Drop the less-overdue direction; it defers to a later,
  // naturally-spaced session. Runs BEFORE the practicePerDay cap so a dropped card frees its slot to
  // the next due word — the session still fills to the limit (it just won't ask a word twice).
  const deduped = dedupeDirections(practice)

  const capped = deduped.slice(0, limits.practicePerDay).map((c) => c.card)
  // Words whose recognition is being asked this session: their production must be held back too,
  // including a promoted meaning that would otherwise ride along in a sense group. (SPEC §278)
  const recognitionShown = new Set(
    capped.filter((c) => c.skill === 'recognize').map((c) => c.targetEntryId),
  )
  const practiceCards = groupProductionCards(
    capped,
    entryById,
    input.translations,
    rsByKey,
    now,
    recognitionShown,
  )
  const newCards = fresh.slice(0, newBudget).map((c) => c.card)

  return { practiceCards, newCards, newDoneToday }
}

/**
 * Enforce one direction per word per session (SPEC §278). When a word has BOTH a due recognition
 * card and one or more due production cards (its primary meaning and/or a promoted meaning), keep
 * only the more-overdue direction and drop the other — asking the reverse in the same sitting, right
 * after the answer was revealed, is wasted effort. The dropped direction is still due, so it surfaces
 * in a later session. Otherwise order is preserved.
 *
 * A conflict here always pits two cards that both carry FSRS state: production can only be a no-state
 * calibration candidate once its word's recognition has stabilised, and a stabilised recognition
 * isn't a no-state candidate — so whenever both directions are present, both have a real `due`. The
 * `?? Infinity` fallbacks are defensive only.
 */
function dedupeDirections(practice: Candidate[]): Candidate[] {
  const recByEntry = new Map<string, Candidate>()
  const prodByEntry = new Map<string, Candidate[]>()
  for (const c of practice) {
    const entryId = c.card.targetEntryId
    if (c.card.skill === 'recognize') recByEntry.set(entryId, c)
    else prodByEntry.set(entryId, [...(prodByEntry.get(entryId) ?? []), c])
  }

  const drop = new Set<Candidate>()
  for (const [entryId, rec] of recByEntry) {
    const prods = prodByEntry.get(entryId)
    if (!prods?.length) continue // recognition only — no conflict
    const recDue = rec.card.reviewState?.due ?? Infinity
    const minProdDue = Math.min(...prods.map((p) => p.card.reviewState?.due ?? Infinity))
    // Ties go to recognition (the anchor direction): keep it, defer production.
    if (recDue <= minProdDue) for (const p of prods) drop.add(p)
    else drop.add(rec)
  }
  return drop.size === 0 ? practice : practice.filter((c) => !drop.has(c))
}

/**
 * Collapse the production cards of one sense-group into a single multi-answer card. (plan, SPEC §6)
 *
 * The seed splits a native concept (e.g. "clearly") into senses; the Swedish answers of one sense
 * share a grouping key. For a word's PRIMARY meaning that key lives on its target Entry's `sense.key`
 * ("in a clear way" → tydligt, klart); for a PROMOTED meaning (meaningKey > 0) it lives on the link's
 * `senseKey`, so a promoted meaning is grouped with the other words of its sense too (e.g. `husband` →
 * make's primary + man's promoted meaning, asked as one card). A member is any sibling the learner has
 * been INTRODUCED to — recognised or produced (a promoted meaning, having no recognition card, counts
 * once its production exists). When ≥2 members are introduced and at least one's production is due
 * today, we ask the concept once: a single card carrying every introduced member, graded together (a
 * recognition-only member's produce state is created when it's first graded). A sibling never seen in
 * any skill is NOT pulled in; nor is a recognition-only member whose recognition is itself due this
 * session — that would be the "free reverse" production gating avoids (§6 1b), so it joins a later
 * session. Members not currently due add no session slot; they ride the group's reveal and grade.
 */
function groupProductionCards(
  practiceCards: SessionCard[],
  entryById: Map<string, Entry>,
  translations: Translation[],
  rsByKey: Map<string, ReviewState>,
  now: number,
  recognitionShown: Set<string>,
): SessionCard[] {
  // Introduced members per sense key: siblings the learner has seen in ANY skill (recognised or
  // produced). `produceDue` is the member's production due, or Infinity if it has no produce state yet
  // — such a member rides along as an answer but can't, on its own, surface the group.
  const membersByKey = new Map<string, { translationId: string; targetEntryId: string; produceDue: number }[]>()
  for (const t of translations) {
    // The grouping key: a PRIMARY meaning takes it from its target entry's `sense.key`; a PROMOTED
    // meaning (meaningKey > 0) takes it from the link's own `senseKey` — so a promoted meaning groups
    // with the other Swedish words of its sense (e.g. `husband` → make + man) instead of wrongly
    // inheriting the primary's sense. Absent key → not part of a partitioned concept → solo card. (§12)
    const key = t.primary ? entryById.get(t.targetEntryId)?.sense?.key : t.senseKey
    if (!key) continue
    const rec = rsByKey.get(`${t.id}:recognize`) // undefined for a promoted meaning (recognition is per word)
    const prod = rsByKey.get(`${t.id}:produce`)
    if (!rec && !prod) continue // never introduced in any skill → not a member
    // Hold this member's production back if its WORD's recognition is being asked this session —
    // asking the reverse in the same sitting is wasted effort (SPEC §278). Covers both a recognition-
    // only member and one that also has its own produce state; it joins a later session either way.
    if (recognitionShown.has(t.targetEntryId)) continue
    // Belt-and-braces for a recognition-only member whose recognition is due but fell outside the
    // practice cap (so it isn't in `recognitionShown`): still defer its production. (§6 1b)
    if (!prod && rec && rec.due <= now) continue
    const list = membersByKey.get(key) ?? []
    list.push({ translationId: t.id, targetEntryId: t.targetEntryId, produceDue: prod ? prod.due : Infinity })
    membersByKey.set(key, list)
  }

  // A group surfaces when ≥2 members are introduced and at least one's PRODUCTION is due today.
  const groupCardByKey = new Map<string, SessionCard>()
  const memberToKey = new Map<string, string>()
  for (const [key, members] of membersByKey) {
    if (members.length < 2 || !members.some((m) => m.produceDue <= now)) continue
    const ordered = [...members].sort((a, b) => a.produceDue - b.produceDue || a.translationId.localeCompare(b.translationId))
    const rep = ordered[0] // earliest produce-due member drives the slot (it has a real due card)
    groupCardByKey.set(key, {
      translationId: rep.translationId,
      targetEntryId: rep.targetEntryId,
      skill: 'produce',
      mode: 'practice',
      reviewState: rsByKey.get(`${rep.translationId}:produce`),
      group: { members: ordered.map((m) => ({ translationId: m.translationId, targetEntryId: m.targetEntryId })) },
    })
    for (const m of members) memberToKey.set(m.translationId, key)
  }
  if (groupCardByKey.size === 0) return practiceCards

  // Replace each group's member produce cards with one group card, at the first (earliest-due) slot.
  const emitted = new Set<string>()
  const out: SessionCard[] = []
  for (const card of practiceCards) {
    const key = card.skill === 'produce' ? memberToKey.get(card.translationId) : undefined
    if (key) {
      if (!emitted.has(key)) {
        emitted.add(key)
        out.push(groupCardByKey.get(key)!)
      }
      continue // drop redundant member cards
    }
    out.push(card)
  }
  return out
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

// --- Live daily limits: windowing the frozen master (SPEC §6.2) ------------------------------------

/** A card's stable identity for done-tracking (translation + direction). A re-queued clone and a group
 *  card share their origin's key, so counting distinct keys present never double-counts. */
export function cardKey(card: SessionCard): string {
  return `${card.translationId}:${card.skill}`
}

/**
 * The queue to serve for `local` limits: the first `localPractice` practice and `localNew` new cards of
 * the master, EXCLUDING anything already done (key in `doneKeys`), then interleaved. Done cards occupy
 * their budget — 25 practice done with a limit of 30 serves only 5 more; a limit at or below the done
 * count serves none (the session reads as finished). Callers prepend the consumed prefix so the cursor
 * stays put — that's how a mid-session limit change keeps your place.
 */
export function windowMaster(
  master: SessionMaster,
  local: DailyLimits,
  doneKeys: Set<string> = new Set(),
): SessionCard[] {
  const take = (pool: SessionCard[], limit: number): SessionCard[] => {
    const remaining = pool.filter((c) => !doneKeys.has(cardKey(c)))
    const done = pool.length - remaining.length
    return remaining.slice(0, Math.max(0, limit - done))
  }
  return interleave(take(master.practice, local.practicePerDay), take(master.news, local.newPerDay))
}

/** Whether "Push further" can still pull anything: a budget with room left in the master AND a non-zero
 *  daily amount to widen by (a budget the user zeroed out isn't extended). */
export function canPushFurtherFor(local: DailyLimits, global: DailyLimits, master: SessionMaster): boolean {
  return (
    (global.practicePerDay > 0 && local.practicePerDay < master.practice.length) ||
    (global.newPerDay > 0 && local.newPerDay < master.news.length)
  )
}

/**
 * The new local limits after the Profile ("global") limits change. Per budget: while NOT pushed
 * (local == global) local tracks the new global up or down; once PUSHED (local > global) a global change
 * can only RAISE local, never shrink today's extended session. `prevGlobal` is the global in force
 * before this change — the pre-change `local > prevGlobal` is exactly "was pushed". (SPEC §6.2)
 */
export function reconcileLimits(
  local: DailyLimits,
  prevGlobal: DailyLimits,
  nextGlobal: DailyLimits,
): DailyLimits {
  const per = (k: keyof DailyLimits): number =>
    local[k] > prevGlobal[k] ? Math.max(local[k], nextGlobal[k]) : nextGlobal[k]
  return { newPerDay: per('newPerDay'), practicePerDay: per('practicePerDay') }
}

/** The local limits after one "Push further": widen each budget by another day's worth (the global
 *  amount), clamped to the master's size — so a day can never exceed the frozen snapshot. */
export function extendLimits(local: DailyLimits, global: DailyLimits, master: SessionMaster): DailyLimits {
  return {
    newPerDay: Math.min(master.news.length, local.newPerDay + global.newPerDay),
    practicePerDay: Math.min(master.practice.length, local.practicePerDay + global.practicePerDay),
  }
}

/** Build the day's full pool, frozen at first compose. Composed at the MAX caps so later limit changes
 *  / Push further reveal more of it without recomposing; `newDoneToday` lets the caller budget the day's
 *  remaining new-word introductions. */
export function buildMasterPure(input: ComposerInput): { master: SessionMaster; newDoneToday: number } {
  const { practiceCards, newCards, newDoneToday } = composeParts({
    ...input,
    limits: { newPerDay: MAX_NEW_PER_DAY, practicePerDay: MAX_PRACTICE_PER_DAY },
  })
  return { master: { practice: practiceCards, news: newCards }, newDoneToday }
}

/** Local midnight for a timestamp — the boundary for daily budgets. */
function startOfLocalDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The initial state of a freshly composed session: the served queue plus the frozen master and the
 *  day's starting local limits, so the caller can persist them for later windowing (limit changes /
 *  Push further). */
export interface ComposedSession {
  cards: SessionCard[]
  master: SessionMaster
  localLimits: DailyLimits
  canPushFurther: boolean
}

/**
 * Compose today's session for the active profile, loading from Dexie. Freezes the day's full master and
 * windows it at the profile's limits — new floored by what's already been introduced today (a reviewed
 * practice card's due moves to the future, so practice needs no such subtraction). The master + local
 * limits are returned for the caller to persist; changing limits or pushing further re-windows the same
 * frozen master rather than recomposing.
 */
export async function composeSession(now: number = Date.now()): Promise<ComposedSession> {
  const empty: ComposedSession = {
    cards: [],
    master: { practice: [], news: [] },
    localLimits: { newPerDay: 0, practicePerDay: 0 },
    canPushFurther: false,
  }
  const profile = await getActiveProfile()
  if (!profile) return empty

  const entries = await db.entries.where('lang').equals(profile.targetLang).toArray()
  const entryIds = entries.map((e) => e.id)
  const translations = await db.translations.where('targetEntryId').anyOf(entryIds).toArray()
  const translationIds = translations.map((t) => t.id)
  const reviewStates = await db.reviewStates.where('translationId').anyOf(translationIds).toArray()

  const { master, newDoneToday } = buildMasterPure({
    now,
    dayStart: startOfLocalDay(now),
    level: profile.claimedLevel,
    limits: profile.dailyLimits,
    entries,
    translations,
    reviewStates,
  })
  const localLimits: DailyLimits = {
    newPerDay: Math.max(0, profile.dailyLimits.newPerDay - newDoneToday),
    practicePerDay: profile.dailyLimits.practicePerDay,
  }
  return {
    cards: windowMaster(master, localLimits),
    master,
    localLimits,
    canPushFurther: canPushFurtherFor(localLimits, profile.dailyLimits, master),
  }
}

/** What `recordReview` wrote, enough for `undoReview` to reverse it exactly. */
export interface ReviewUndo {
  /** The pre-rating row to restore, or undefined if the rating created the row. */
  previous: ReviewState | undefined
  /** The id of the row `recordReview` wrote (the one to delete when there was no previous). */
  writtenId: string
  /** The post-rating row that was written. Lets an in-session relearning re-queue carry the
   *  freshly-updated state onto the re-shown clone, so its next grade builds on this answer rather
   *  than the stale pre-answer snapshot. `undoReview` ignores it. */
  next: ReviewState
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
  return { previous, writtenId: next.id, next }
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

/** One answer's self-assessment in a multi-answer group: its translation + the grade given to it. */
export interface GroupRating {
  translationId: string
  label: RatingLabel
}

/**
 * Pure PER-WORD grading of a multi-answer production group: each member is graded with its OWN label
 * (the learner rates each answer on its own tab; "Knew all" simply sends every remaining answer in as
 * `good`). A member with no prior produce state gets a fresh one. Each member keeps its own independent
 * ReviewState (SPEC §4.4). The caller persists the returned rows.
 */
export function gradeGroup(
  members: { translationId: string; reviewState?: ReviewState; label: RatingLabel }[],
  now: number = Date.now(),
): ReviewState[] {
  return members.map((m) => {
    const base = m.reviewState ?? createReviewState(m.translationId, 'produce', now)
    return applyRating(base, m.label, now)
  })
}

/** What `recordGroupReview` wrote, enough for `undoGroupReview` to reverse it exactly. */
export interface GroupReviewUndo {
  writes: ReviewUndo[]
}

/**
 * Grade a multi-answer production group (each answer with its own label) and persist every member's
 * produce state. Re-reads each member's CURRENT state first — a member pulled into the group may not
 * have been due, so the card's embedded snapshot can be stale. Returns a token `undoGroupReview`
 * reverses exactly.
 */
export async function recordGroupReview(
  ratings: GroupRating[],
  now: number = Date.now(),
): Promise<GroupReviewUndo> {
  const graded = await Promise.all(
    ratings.map(async (r) => ({
      translationId: r.translationId,
      reviewState: await getReviewState(r.translationId, 'produce'),
      label: r.label,
    })),
  )
  const next = gradeGroup(graded, now)
  await db.reviewStates.bulkPut(next)
  return { writes: next.map((row, i) => ({ previous: graded[i].reviewState, writtenId: row.id, next: row })) }
}

/** Reverse a `recordGroupReview`: restore each member's prior row, or delete rows the rating created. */
export async function undoGroupReview(undo: GroupReviewUndo): Promise<void> {
  for (const w of undo.writes) {
    if (w.previous) await db.reviewStates.put(w.previous)
    else await db.reviewStates.delete(w.writtenId)
  }
}

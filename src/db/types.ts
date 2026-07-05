// Entity interfaces for the Yak data model. See SPEC §4.

import type { SessionCard } from '../srs/session-composer'

export type Cefr = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'

export type PartOfSpeech =
  | 'noun'
  | 'verb'
  | 'adj'
  | 'adv'
  | 'prep'
  | 'conj'
  | 'pron'
  | 'num'
  | 'interj'
  | 'phrase'
  | 'other'

export type Source = 'seed' | 'user'

/**
 * The user's per-word practice override — a single dimension. (SPEC §7.5)
 * - `skip`   → never practiced (manual exclude)
 * - `auto`   → follow scope: practiced iff in the study set by level / SRS / source
 * - `always` → always practiced (manual include, even above level)
 */
export type StudyPref = 'skip' | 'auto' | 'always'

export type IpaSource = 'wiktionary' | 'ipa-dict' | 'user' | 'generated'

/** A seed example sentence tagged with the meaning it illustrates. A word's sentence uses the lemma in
 *  exactly one sense, so `meaningKey` (0 = primary, 1+ = a promoted altMeaning) lets a production card
 *  show only its own sense's examples while recognition shows them all. (per-sense examples, §4.8) */
export interface ExampleSentence {
  text: string
  meaningKey: number
}

/** Recognition = see target, recall native. Production = see native, produce target. */
export type Skill = 'recognize' | 'produce'

export type ReviewStateName = 'new' | 'learning' | 'review' | 'relearning'

/** The atomic unit — single words, multi-word expressions, and full phrases. (SPEC §4.1) */
export interface Entry {
  id: string // ULID
  lang: string // BCP-47, e.g. "sv", "en", "de"
  lemma: string // dictionary form, plain (no "att" / "to" / "der")
  pos: PartOfSpeech
  features: Record<string, string> // language-specific, e.g. { gender: "en" }
  inflections: Record<string, string> // e.g. { presens: "springer", preteritum: "sprang" }
  pronunciation: {
    ipa?: string
    ipaSource?: IpaSource
    // True when the same lemma has senses pronounced differently (e.g. kort kɔrt/kʊrt). Browser TTS
    // can't be steered to a sense, so the audio button is suppressed — the per-sense IPA still shows.
    ambiguous?: boolean
  }
  cefr?: Cefr // present for seed entries; absent for user entries
  disambiguator?: string // e.g. "datafil" when multiple senses share the lemma
  subDefinitions?: string[] // when senses were merged at build time
  // Production grouping (multi-answer cards): which sense of the shared native concept this answer
  // belongs to. Target entries with the same `key` are asked as one production card and graded
  // together; `gloss` is the short native hint shown on the prompt (empty when the concept has a
  // single sense). Seed-generated; absent on entries the sense pass hasn't covered. (SPEC §6, plan)
  sense?: { key: string; gloss: string }
  examples?: ExampleSentence[] // seed-provided, tagged by meaning (user examples live on the overlay)
  source: Source
  seedVersion?: string // when source = seed
  seedKey?: number // stable cross-version key (Kelly id) for seed sync; on the target entry only
  seedHash?: string // per-entry content hash; seed-sync only rewrites a card when this changes
  study: StudyPref // per-word practice override (replaces the old userFlagged + hidden)
  createdAt: number
  updatedAt: number
}

/** User annotations layered on top of entries; never mutates the seed row. (SPEC §4.2) */
export interface EntryOverlay {
  id: string // ULID
  entryId: string // FK → Entry.id
  noteText?: string
  customExamples?: string[]
  customTranslation?: string // overrides default translation when present
  translationLang: string // BCP-47 — language of customTranslation
  createdAt: number
  updatedAt: number
}

/** Links a target-language entry to a native-language entry. (SPEC §4.3)
 *
 * A target word may link to several native entries — one per distinct *practiceable meaning*
 * (multi-meaning design). Each such link is its own card with its own per-skill ReviewState.
 * `meaningKey` is a small stable per-word integer (primary = 0, extras 1, 2, …) assigned
 * append-only, so seed-sync can match a meaning across seed updates by `(seedKey, meaningKey)`
 * even when its text changes. `primary` (meaningKey === 0) is the recognition-bearer: recognition
 * is asked once per *word* off the primary link; production is per *meaning*. */
export interface Translation {
  id: string // ULID
  targetEntryId: string // the target-language word (e.g. Swedish)
  nativeEntryId: string // the native-language word (e.g. English)
  meaningKey: number // stable per-word key for sync (primary = 0, extra meanings 1, 2, …)
  primary: boolean // the recognition-bearer (meaningKey === 0)
  // Production-prompt gloss for a PROMOTED meaning (meaningKey > 0): the short parenthetical hint
  // shown when this meaning's English phrase is also produced by other Swedish words (e.g. the
  // promoted `route` of `led`). The primary meaning's gloss lives on `Entry.sense.gloss` instead, so
  // production reads `translation.gloss ?? entry.sense?.gloss` uniformly. Absent when unambiguous.
  // Authored wholesale by the sense/gloss pass; populated at build (buildEntry) + on sync. (§12)
  gloss?: string
  // Production-grouping key for a PROMOTED meaning (meaningKey > 0): the `english#sense` key of the
  // concept-sense this meaning belongs to, so the composer can ask it TOGETHER with the other Swedish
  // words of the same sense as one multi-answer card (e.g. `husband` → make + man). The primary
  // meaning's key lives on `Entry.sense.key` instead, so `groupProductionCards` reads
  // `primary ? entry.sense.key : translation.senseKey`. Absent when the meaning isn't part of a
  // partitioned (≥2-producer) concept. Authored by the sense/gloss pass; stamped at build + on sync.
  senseKey?: string
  source: Source
  createdAt: number
}

/** One row per (Translation, skill direction). Holds FSRS state. (SPEC §4.4) */
export interface ReviewState {
  id: string // ULID
  translationId: string
  skill: Skill
  // FSRS fields (from ts-fsrs):
  difficulty: number
  stability: number
  reps: number
  lapses: number
  state: ReviewStateName
  due: number // unix ms
  lastReview: number | null
  scheduledDays: number
  elapsedDays: number
  learningSteps: number // ts-fsrs Card.learning_steps — current (re)learning step index
  createdAt: number
  updatedAt: number
}

/** Per-language-pair user profile. Exactly one is active. (SPEC §4.5) */
export interface Profile {
  id: string // ULID
  learnerLang: string // BCP-47, e.g. "en"
  targetLang: string // BCP-47, e.g. "sv"
  claimedLevel: Cefr | 'below-A1'
  dailyLimits: {
    newPerDay: number // default 20
    practicePerDay: number // default 200
  }
  // Monthly "back up your data" reminder, mirrored from the calorie-counter sibling app. Undefined = on.
  exportReminderEnabled?: boolean
  // "YYYY-MM" of the month the reminder was last dismissed, so it stays hidden for the rest of that month.
  exportReminderDismissedUntil?: string
  active: boolean
  createdAt: number
  updatedAt: number
}

/** Small key→value store for app-level metadata that isn't entity data — e.g. the seed version the
 *  DB has been synced to (`seedVersion`), the authoritative marker the seed-sync gate reads. */
export interface MetaRecord {
  key: string
  value: string
}

/** Parsed ipa-dict dictionary for a language, cached for offline use. (SPEC §10.1) */
export interface IpaDictRecord {
  lang: string
  dict: Record<string, string> // lowercased word → IPA (no slashes)
  fetchedAt: number
}

/** One Wiktionary POS-section (a distinct lexeme) the user can pick. (SPEC §7.4, §10.2) */
export interface EnrichmentCandidate {
  pos: PartOfSpeech
  gender?: string // "en" | "ett"
  inflections?: Record<string, string>
  gloss?: string // first definition, for disambiguation
}

/** Cached Wiktionary lookup for one (lang, lemma). (SPEC §10.2) */
export interface WiktionaryCacheRecord {
  key: string // `${lang}:${lemma}`
  lang: string
  lemma: string
  candidates: EnrichmentCandidate[]
  fetchedAt: number
}

/** Combined runtime enrichment for a word (ipa-dict + Wiktionary). (SPEC §10) */
export interface EnrichmentResult {
  ipa?: string
  candidates: EnrichmentCandidate[] // 0 = nothing found, 1 = auto-fill, many = let user pick
}

/**
 * Persisted snapshot of the in-progress practice session, so a page refresh resumes the same queue
 * at the same position instead of recomposing from scratch. Singleton — one active session at a time
 * (keyed by the literal id `'active'`). The heavy display data isn't stored: only the lightweight
 * `SessionCard[]` queue is, re-resolved to views via `getPracticeCardView` on load.
 */
export interface ActiveSessionRecord {
  id: string // singleton key, always 'active'
  profileId: string // validated on resume → recompose after a profile/language switch
  dayKey: string // validated on resume → recompose on a new day
  cards: SessionCard[] // the queue, in order
  index: number // cursor — how far the user has progressed
  canPushFurther: boolean
  updatedAt: number
}

/** Lightweight session history. (SPEC §4.6) */
export interface SessionLog {
  id: string
  profileId: string
  startedAt: number
  endedAt: number
  reviewedCount: number
  newCount: number
  ratingsBreakdown: { again: number; hard: number; good: number; easy: number }
}

// --- Practice+ drills (grammar exercises) -----------------------------------------------------
// A separate track from normal Practice: attribute drills over words the learner already knows
// (en/ett gender first; verb forms later). They deliberately DON'T use FSRS — no due dates, no
// scheduler. Progress is a Leitner-lite "box" per (word, drill): a wrong answer sends the word to
// box 0, a right answer promotes it, and the picker weights low boxes highest so struggling/unseen
// words resurface and mastered ones appear increasingly rarely (never dropping out entirely).

/**
 * The kinds of Practice+ drill, namespaced by the TARGET language that owns them — a drill is
 * determined by the target language, not the pair (Swedish's en/ett, German's der/die/das, Polish's
 * declensions). New drills add a member here and a definition under `src/lang/<code>/drills/`.
 */
export type DrillType = 'sv:gender'

/** Per (word, drill) progress — the Leitner-lite box. No due date; the box alone drives selection. */
export interface DrillStat {
  entryId: string
  drill: DrillType
  box: number // 0 = struggling/unseen … grows on each pass; reset to 0 on a fail
  seen: number
  lastResult: 'pass' | 'fail'
  lastSeenAt: number
}

/**
 * The in-progress drill session. Singleton (`id: 'active'`) — one drill runs at a time, and the
 * Practice+ tab shows it instead of the picker until it's finished. Unlike a normal practice session
 * it has NO day gate: it resumes in place across refreshes and days, and only a manual finish/exit
 * clears it. The `queue` is frozen at start (weighted by the box model at that moment).
 */
export interface ActiveDrillSession {
  id: string // singleton key, always 'active'
  profileId: string // validated on resume → dropped after a profile/language switch (queue is per-language)
  drill: DrillType
  queue: string[] // frozen entryId order
  index: number // cursor — how many have been answered
  tally: { correct: number; missed: string[] } // running result; `missed` feeds the end-of-session review
  startedAt: number
  updatedAt: number
}

/** One finished drill session — lightweight history for the hub's "recent form" line. (§4.6-style) */
export interface DrillSessionLog {
  id: string
  profileId: string
  drill: DrillType
  startedAt: number
  endedAt: number
  attempted: number
  correct: number
  endedEarly: boolean // true when the user exited before the batch was done
}

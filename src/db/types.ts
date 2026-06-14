// Entity interfaces for the Yak data model. See SPEC §4.

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
  }
  cefr?: Cefr // present for seed entries; absent for user entries
  disambiguator?: string // e.g. "datafil" when multiple senses share the lemma
  subDefinitions?: string[] // when senses were merged at build time
  source: Source
  seedVersion?: string // when source = seed
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

/** Links a target-language entry to a native-language entry. (SPEC §4.3) */
export interface Translation {
  id: string // ULID
  targetEntryId: string // the target-language word (e.g. Swedish)
  nativeEntryId: string // the native-language word (e.g. English)
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
  active: boolean
  createdAt: number
  updatedAt: number
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

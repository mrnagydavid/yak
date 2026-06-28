# Yak — Specification

> Vocabulary trainer PWA. Name plays on *to yak* (to talk) and the mascot.

---

## 1. Overview

**Yak** is a Progressive Web App for vocabulary training, tailored to language learning rather than generic flashcards. Built on the same stack used for prior projects (Vite + Preact + CSS Modules + Dexie + pnpm), entirely client-side, with no backend for as long as possible.

Yak helps a learner build vocabulary in a target language through CEFR-graded introduction of new words and FSRS-driven spaced repetition of practice. It ships with a curated seed wordlist per supported language, lets the user add their own words and phrases, and supports per-skill (recognition vs production) tracking.

The user's mental model is **words**, not cards. Decks, card templates, and SRS internals are deliberately absent from the UI.

## 2. Goals and non-goals

### Goals

- Single-user, single-active-language at a time, on-device storage
- CEFR-graded learning logic with optional self-paced override
- Bidirectional skill tracking (recognition and production as independent FSRS states)
- Display fidelity: per-language render modules handle POS markers, conjugations, gender, IPA, audio
- Friction-light add flow for user-contributed words and phrases
- Reasonable handling of polysemy (merge by translation, split otherwise, with disambiguators)
- Generic data model supporting Germanic, Romance, and (later) Slavic languages without per-language schema changes

### Non-goals

- **Not a dictionary.** Translation-direction lookup is out of scope. The user looks meanings up externally and records the word in the app.
- **Not a general flashcard tool.** No deck management, no card templates, no shared deck marketplace.
- **No backend in v1.** All data lives in IndexedDB (Dexie). No accounts, no sync, no server.
- **No social features.** No sharing, no leaderboards, no streaks-as-pressure.
- **No paid tier or analytics.** Pure local app.

## 3. Stack and build constraints

| Concern | Choice |
|---|---|
| Build tool | Vite (pinned version) |
| UI framework | Preact (pinned) |
| Styling | CSS Modules |
| Storage | Dexie.js (IndexedDB wrapper) |
| Package manager | pnpm |
| Linter | oxlint |
| Type system | TypeScript |
| SRS algorithm | FSRS via `ts-fsrs` |
| Test framework | Vitest |

**Version pinning policy.** All dependencies in `package.json` use exact versions (`"preact": "10.27.2"`, never `"^10.27.2"` or `"~10.27.2"`). `pnpm-lock.yaml` is committed. `engines.node` pinned to a specific major. Updates are manual and explicit — no Renovate, no Dependabot. `CONTRIBUTING.md` documents this rule.

**Data source pinning.** The same principle extends to upstream data sources used during seed generation: ipa-dict commit hash, kaikki.org Wiktionary dump date, Kelly wordlist version. Recorded in `data/sources.json` so seed rebuilds are reproducible.

**No unnecessary dependencies.** Each new dependency requires justification. Prefer standard library + small utilities over frameworks.

## 4. Data model

All entities live in Dexie (IndexedDB). Schema below.

### 4.1 `Entry`

The atomic unit. Covers single words, multi-word expressions, and full phrases. Internally named `Entry` (not `Lexeme` or `Word`); UI labels adapt to context.

```ts
interface Entry {
  id: string;                       // ULID
  lang: string;                     // BCP-47, e.g. "sv", "en", "de"
  lemma: string;                    // dictionary form, plain (no "att" / "to" / "der")
  pos: PartOfSpeech;                // closed enum: noun | verb | adj | adv | prep | conj | pron | num | interj | phrase | other
  features: Record<string, string>; // language-specific: { gender: "en" } for Swedish, { gender: "der" } for German; { countable: "no" } marks uncountable nouns (renderer omits the article)
  inflections: Record<string, string>; // Swedish verbs: { presens, preteritum, supinum, imperativ }; Swedish nouns: { definiteSingular, indefinitePlural, definitePlural } (indefinite singular = lemma)
  pronunciation: {
    ipa?: string;
    ipaSource?: "wiktionary" | "ipa-dict" | "user" | "generated";
  };
  cefr?: "A1" | "A2" | "B1" | "B2" | "C1" | "C2"; // present for seed entries; absent for user entries
  disambiguator?: string;           // e.g. "datafil" when multiple senses share the lemma
  subDefinitions?: string[];        // when senses were merged at build time (mena example)
  source: "seed" | "user";
  seedVersion?: string;             // when source = seed; identifies which seed build produced this
  study: "skip" | "auto" | "always"; // per-word practice override (single dimension). auto = follow scope (level/SRS/source); always = force in; skip = force out. Replaces the older userFlagged + hidden booleans.
  createdAt: number;
  updatedAt: number;
}
```

### 4.2 `EntryOverlay`

User annotations layered on top of seed entries. Never modifies the seed `Entry` row itself, so seed updates merge cleanly.

```ts
interface EntryOverlay {
  id: string;                       // ULID
  entryId: string;                  // foreign key → Entry.id
  noteText?: string;                // user's memory aid / free-form note
  customExamples?: string[];
  customTranslation?: string;       // overrides the default translation when present
  translationLang: string;          // BCP-47 — which language is the customTranslation in
  createdAt: number;
  updatedAt: number;
}
```

For user-source entries, overlay fields can also be used; an overlay is created on first edit.

### 4.3 `Translation`

Links an entry in the target language to one or more entries in the learner's native language.

```ts
interface Translation {
  id: string;                       // ULID
  targetEntryId: string;            // the target-language word (e.g. Swedish)
  nativeEntryId: string;            // the native-language word (e.g. English)
  source: "seed" | "user";
  createdAt: number;
}
```

A target entry may have multiple translations (one-to-many in either direction). When it does, the disambiguator on each entry resolves ambiguity in the UI.

### 4.4 `ReviewState`

One row per (Translation, skill direction). Holds the FSRS state.

```ts
interface ReviewState {
  id: string;                       // ULID
  translationId: string;
  skill: "recognize" | "produce";   // recognize = see target → recall native; produce = see native → produce target
  // FSRS fields (from ts-fsrs):
  difficulty: number;
  stability: number;
  reps: number;
  lapses: number;
  state: "new" | "learning" | "review" | "relearning";
  due: number;                      // unix ms
  lastReview: number | null;
  scheduledDays: number;
  elapsedDays: number;
  // Tracking:
  createdAt: number;
  updatedAt: number;
}
```

Two `ReviewState` rows per translation: one for `recognize`, one for `produce`. They evolve independently.

### 4.5 `Profile`

Per-language-pair user profile.

```ts
interface Profile {
  id: string;                       // ULID
  learnerLang: string;              // BCP-47, e.g. "en"
  targetLang: string;               // BCP-47, e.g. "sv"
  claimedLevel: "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "below-A1";
  dailyLimits: {
    newPerDay: number;              // default 20
    practicePerDay: number;         // default 200
  };
  active: boolean;                  // exactly one profile active at a time
  createdAt: number;
  updatedAt: number;
}
```

Profile switching preserves all per-language state. Multiple profiles may exist; only one is active.

### 4.6 `SessionLog`

Lightweight session history for the all-caught-up screen and future analytics.

```ts
interface SessionLog {
  id: string;
  profileId: string;
  startedAt: number;
  endedAt: number;
  reviewedCount: number;
  newCount: number;
  ratingsBreakdown: { again: number; hard: number; good: number; easy: number };
}
```

### 4.7 Indices

Dexie schema, version 1:

```ts
db.version(1).stores({
  entries: 'id, lang, lemma, [lang+lemma], pos, source, cefr',
  entryOverlays: 'id, entryId, &entryId',
  translations: 'id, targetEntryId, nativeEntryId',
  reviewStates: 'id, translationId, skill, [translationId+skill], due, state',
  profiles: 'id, active, [learnerLang+targetLang]',
  sessionLogs: 'id, profileId, startedAt',
});
```

## 5. Language support

### 5.1 Per-language render modules

Each supported language has a small render module (~50–100 lines) at `src/lang/<lang>/render.ts`. The module exports:

```ts
interface LanguageRenderer {
  // Format an entry's lemma for display, including POS-specific prefixes/articles
  renderLemma(entry: Entry): string;
  // Format the inflection block (table or one-line summary)
  renderInflections(entry: Entry): InflectionDisplay;
  // Format gender or other feature badges
  renderFeatures(entry: Entry): FeatureBadge[];
  // Whether to display IPA for this language (true for target-language render)
  showIpa: boolean;
}
```

Examples:

- **Swedish (`sv`)**: verbs render as `att springa` with principal parts `springer · sprang · sprungit · Spring!` (imperative capitalised with `!`); nouns render with `en` / `ett` prefix and the declension `hunden · hundar · hundarna` (definite sg, indefinite pl, definite pl); gender badge color-coded. **Uncountable nouns** (`features.countable = "no"`) drop the article — `vatten`, not `ett vatten` — while the gender still shows as a badge.
- **English (`en`)**: verbs render as `to run (runs, ran, run)`; nouns get `a` / `an` based on phonetic rule (uncountable nouns drop it — `water`, not `a water`); no IPA in display.
- **German (`de`)**: nouns render with `der` / `die` / `das` and plural; verbs render with infinitive + Stammformen; gender badges color-coded.
- **Spanish (`es`)**: verbs render with infinitive + first-person present + preterite + past participle; nouns with `el` / `la` and plural.
- **French (`fr`)**: similar pattern, with gender, plural, and key conjugations.

Adding a new language is one render module + one seed file. No core code changes.

### 5.2 v1 language scope

- **Swedish (target) ↔ English (native)** ships in v1.
- German, Spanish, French planned for v2 in that order.

### 5.3 CEFR data availability

| Language | CEFR source | Notes |
|---|---|---|
| Swedish | Kelly Project (CC-BY) | Direct CEFR tagging; primary source |
| English | Kelly Project (for native-language entries) | Less critical since English is the learner's native |
| German | Goethe-Institut A1/A2/B1 wordlists (community transcriptions) + Wiktionary frequency for B2+ | A1–B1 strong; B2+ heuristic |
| Spanish | Wiktionary frequency, heuristic CEFR banding | No open canonical CEFR list; cleanup pass critical |
| French | Wiktionary frequency, heuristic CEFR banding | Same as Spanish |

## 6. Learning logic

### 6.1 The eligibility rule

Each entry carries a single `study` override: `always` (force in), `skip` (force out), or
`auto` (follow scope). A word is **in the user's study set** when:

- `study = always` — the user forced it in; **else**
- `study = skip` — the user forced it out (never in); **else** (`study = auto`) if any of:
  - `source = user` — the user added it themselves
  - Has SRS state — they've encountered it (orphan protection across level changes)
  - `source = seed AND cefr <= UserLevel + 1` — natural progression (current level and next)

Within the study set:

- **New pool** = study set entries without SRS state
- **Practice pool** = study set entries with SRS state

The new pool is further constrained for the daily session: drawn primarily from `cefr = UserLevel + 1` (the natural progression) and from user-added / `study = always` entries (explicit choices).

### 6.2 Session composition

A daily session is composed automatically when the user opens the app:

1. **New cards** (up to `dailyLimits.newPerDay`):
   - Pull from new pool, prioritised:
     - User-added entries (no SRS, no level) — always front of the queue
     - User-flagged seed entries (no SRS) — second
     - `cefr = UserLevel + 1` seed entries — fill remainder
2. **Practice cards** (up to `dailyLimits.practicePerDay`):
   - Pull from practice pool ordered by FSRS `due` ascending, then `lastReview` ascending
3. **Interleave**: practice cards first, new cards mixed in at intervals. Anki's pattern: front-load reviews so the deck isn't overwhelmed by new items.

**One direction per word per session.** A session never asks both the recognition and production direction of the same word — doing the reverse right after the answer was just revealed is wasted effort. Concretely, a word's *first* production card is introduced only once recognition has stabilised (recognition-before-production) **and** recognition is not itself due that day; otherwise it defers to a later, naturally-spaced session. Once both directions have their own SRS state they evolve independently (SPEC §4.4), so two long-known directions may occasionally both come due on the same day.

### 6.3 Just-in-time calibration

Seed entries at `cefr ≤ UserLevel` that have no SRS state are still eligible for the practice pool. When such an entry is drawn:

- It's shown in review-style mode (prompt, reveal, rate) — same UI as a practice card
- The user's rating creates the initial FSRS state
- `Again` → effectively new (short interval)
- `Easy` → seeded with a long interval (user knew it)
- Functionally: every word at-or-below claimed level is "calibrated" on its first natural encounter, with no upfront ceremony

**Backlog ordering.** A freshly-levelled profile has no SRS state for any at-or-below-level word, so the calibration backlog can be the entire A1–UserLevel range (thousands of words). §6.2 step 2 pins the order of cards *with* SRS state (by `due`); the no-SRS backlog is instead surfaced as a **weighted proximity mix** so the user practises mostly around their own level rather than grinding up from A1:

- Each candidate gets a sampling weight that **halves per CEFR step below the claimed level** (the user's own band ≈ half the calibration slots, the next ≈ a quarter, and so on — at B1, B1:A2:A1 ≈ 4:2:1). Lower bands stay represented but thin; none are starved.
- Within that weighting, order is a **stable-per-day, day-to-day-varying shuffle**, so a large backlog isn't surfaced in a fixed order and the daily mix rotates.
- Scheduled (has-SRS, due) cards always come first; this weighting only governs how the remaining backlog fills the day's practice budget.
- The decay is a single tunable constant (`CALIBRATION_BAND_DECAY`, default `0.5`); it is scale-invariant, so a higher claimed level simply yields a longer, thinner tail of lower bands.

This is the default mechanism. The explicit calibration sweep (section 6.4) is optional.

### 6.4 Explicit calibration sweep

A user can run a level-assessment sweep at any time. Triggered:

- During onboarding, after picking the target language but before locking in a level
- From the Profile screen at any later point ("not sure? run a quick assessment")

Algorithm:

1. Start at A1.
2. Draw up to 30 entries from the current level at random.
3. For each, show the lemma only (no translation, no IPA, no reveal). User taps *Know* or *Don't know*.
4. After at least 10 items, if the running rate is ≥ 80% known, advance to the next level. Reset the running count and repeat.
5. After 30 items in a level, if rate is still < 80%, stop. The level just completed is the claimed level (or "below A1" if the user failed A1).

Rules:
- **No answer reveal during calibration.** Optional "show me what these meant" summary *after* the sweep is allowed.
- **SRS state is created only for *Know* responses**, seeded as `Good` (FSRS picks the right initial interval).
- **Calibration is purely additive.** A `Don't know` writes nothing — the word remains a future-new candidate.
- **Skippable.** The user can dismiss the sweep at any point and pick a level manually.

Pseudo-words to detect overclaiming are **out of scope for v1**.

### 6.5 Self-evaluation buttons

After reveal, the user rates with four buttons mapped to FSRS:

| Button label | FSRS rating | Color |
|---|---|---|
| Didn't know | Again | red |
| Hard | Hard | amber |
| Knew it | Good | green |
| Easy | Easy | blue |

These same buttons appear on new cards (where they set initial FSRS state) and practice cards (where they update existing state). SRS terminology (`Again`, `ease factor`, intervals) is never shown.

### 6.6 Level changes

- **Raising claimed level**: shifts the new-pool source upward. No other effect.
- **Lowering claimed level**: shifts the new-pool source downward. Already-learned entries (with SRS state at levels above the new claim) remain in the practice pool — never orphaned.

The user can change level any time via Profile.

## 7. Screens and UX

### 7.1 Surface

Three tabs in a persistent bottom bar:

- **Practice** — the active study session
- **Vocabulary** — unified browser of seed + user entries
- **Profile** — language, level, daily limits, calibration trigger, AI key (v2)

Plus a global floating action button **Add** on Practice and Vocabulary (hidden on Profile, auto-hidden when soft keyboard is up).

Word Detail and the Add sheet are presented over the active tab; they don't claim a tab slot.

### 7.2 Practice screen — the study session

**Launch behaviour.** When the app opens (post-onboarding), the Practice tab is active and the first card is already on screen. No home screen, no deck picker, no "start session" gate.

**Layout (mobile, ~380px viewport).** Top: thin progress bar that fills as the session proceeds (no numbers). Centre: prompt area with the target or native word. Below the prompt: the reveal area (collapsed initially in practice mode; expanded initially in new-card mode). Bottom: four self-evaluation buttons, full width, thumb-zone anchored. Below that: persistent tab nav.

**Prompt area.**
- Recognition direction: target-language lemma, with disambiguator in parens if present, IPA in slashes, audio button (TTS). Auto-plays once on appear for *new* cards.
- Production direction: native-language word (with disambiguator if any). No IPA on prompt.

**Reveal area** (collapsed by tap-to-reveal in practice mode; pre-expanded in new mode):
- Translation
- Sub-definitions, if the entry has merged senses (the *mena* case)
- Inflection summary (per-language module)
- Examples (seed-provided, then user-provided)
- User note (if any)
- Visual distinction for user-added or user-overlay content (soft accent stripe at left)

**Self-evaluation buttons.** Always visible. Colour-coded. ~80×64 px tap targets. Light haptic feedback on press.

**Two modes, one layout.** New-card mode pre-expands the reveal; practice-card mode collapses it pending tap. Identical layout otherwise.

**No card numbers, no due counts, no deck names.** The progress bar conveys session progress visually.

**In-session edit.** A small pencil icon top-right on the card. Tap opens a bottom sheet with three optional fields: Note, Examples, Translation override (under *more options*). Saving writes to `EntryOverlay`. No effect on FSRS state. Accessible before *and* after reveal.

**Tap-and-hold on prompt** → opens Word Detail (full edit and history).

**Navigation during session.**
- Bottom tab nav remains visible — leaving mid-session pauses; returning resumes
- No back button on individual cards (no undo in v1)
- Add FAB always accessible

**No "hint" button in v1.**

### 7.3 Vocabulary screen — the unified browser

A single dense list of all entries in the active language, both seed and user.

**Search.** Single input, substring case-insensitive, matches lemma OR translation OR user note.

**Three filter chips.**
- **Source**: All / In my study / Added by me
- **Level**: All / A1 / A2 / B1 / B2 / C1 / C2 / No level
- **Sort**: Alphabetical / Recently practiced / Recently added / Hardest first (highest lapse count)

Defaults: All, All, Alphabetical.

**Row anatomy** (left to right):

1. **★** marker if the entry is in the user's study set; absent otherwise.
2. **Level cell** — `A1`–`C2` for seed; `⚝` glyph for user-added entries.
3. **Status icons** — recognition / production, two coloured glyphs separated by `/`:
   - **⚪** No SRS state (not started, or in study set but never practiced)
   - **🔴** Struggling (recent lapses, short interval despite reps)
   - **🟡** Learning (active SRS state, mid-range interval)
   - **🟢** Solid (long stable interval)
4. **Lemma** with disambiguator in parens when relevant.
5. **Translation** (after `→`).

Long phrases wrap; row grows taller. Numbers are never shown — status is conveyed by colour only.

**Status thresholds** (mapped from FSRS `stability`):

| State | Threshold |
|---|---|
| ⚪ | No `ReviewState` row |
| 🔴 | `lapses >= 3` AND `stability < 7 days` |
| 🟡 | `stability < 30 days` (and not 🔴) |
| 🟢 | `stability >= 30 days` |

Per-skill: each row shows recognition status / production status independently.

**Tap row** → Word Detail.
**Long-press row** → quick action menu (Study, Skip, View detail) — quick shortcuts for the `study` override.

**Performance.** List is virtualised. Seed sets may exceed 8,000 entries.

**Empty state.** "No entries match your filter."

### 7.4 Add flow

Triggered by FAB. Slides up as a sheet.

**Initial state.**
- Header: `✕` close, "Add"
- Active language indicator (flag + name, read-only)
- Single text input, autofocus
- Preview area (populated as user types)

**Behaviour as user types** (debounced ~300ms):

1. Search Dexie for seed matches on `lemma`, case-insensitive, with and without prefix particles (`att`, `to`).
2. Fire Wiktionary REST + ipa-dict lookups in parallel for enrichment (best-effort).
3. Preview updates progressively as data arrives.

**Three result states.**

*State A — seed match(es) found.* List the matches with disambiguator, IPA, level badge, and primary translation. Tap a match → entry is added to the study set (`study = "always"`); a follow-on **Annotation sheet** opens with Note, Examples, and Translation override (collapsed). Saving the annotation sheet (or saving it empty) closes the add flow and returns to wherever the user was. Below the matches is a small "save as a new entry" link for the rare case where the user genuinely wants a separate user-source entry.

*State B — no seed match, enrichment succeeded.* Preview form with fields prefilled:
- Lemma (editable)
- IPA (read-only with edit override; from Wiktionary or ipa-dict, attribution shown)
- POS (read-only with edit override)
- Inflections (read-only with edit override; per-language template)
- Translation (always editable; blank by default — user enters)
- Note (editable)
- Examples (add one or more)
- Primary action **Save**; secondary **Save & add another** (clears the form and refocuses).

*State C — no seed match, no enrichment (offline, phrases, idioms).* Same form, fetched fields blank. Only `lemma` is required.

**Wiktionary client** is a single module wrapping fetch + DOMParser + fail-soft. Sets a polite `User-Agent`. Caches successful lookups in Dexie keyed by `(lang, lemma)` so repeated adds of the same word don't re-fetch.

**Phrases skip Wiktionary** (input contains a space) but ipa-dict is still attempted.

**Lemmatisation assist.** If the typed form is an inflection (e.g. *menade*), Wiktionary often redirects to the lemma (*mena*). The client follows the redirect and presents the lemma; the user can revert to their typed form by editing.

**Save closes the sheet** and returns the user to where they were.

### 7.5 Word Detail screen

Reached by tapping a row in Vocabulary, or tap-and-hold on a card in Practice.

Contents (top to bottom):

- **Header**: lemma + disambiguator + level badge + source marker
- **Pronunciation block**: IPA, audio button
- **Inflection table**: full conjugation/declension per the language renderer
- **Translation(s)**: primary plus any sub-definitions
- **Examples**: seed-provided, then user-provided (with edit / add controls)
- **User note**: free-text edit
- **Progress block**: recognition status + production status, with the same coloured icons used in Vocabulary
- **Last practiced**: relative timestamp ("3 days ago")
- **Practice control**: a single 3-way segmented control — **Skip · Auto · Study** —
  setting the entry's `study` override. *Skip* = never practiced; *Auto* = follow scope
  (the default; tracks level changes); *Study* = always practiced. This replaces the
  earlier separate "add/remove from study set" + "mark as hidden" actions, which were two
  directions of the same single dimension (the contradictory "in but hidden" state is now
  unrepresentable).
- **Actions**:
  - For seed entries: Reset to seed defaults (wipes overlay, with confirm); Override translation
  - For user entries: Edit lemma; Delete entry (with confirm)
  - For both: Per-skill SRS reset (with confirm)

### 7.6 Profile screen

Settings, not a dashboard.

- **Active language pair**: dropdown to switch. Switching loads the other profile's state (level, SRS, etc.); no data is lost.
- **Claimed level**: A1–C2 picker, with a "Not sure? Run a quick assessment" link → calibration sweep.
- **Daily limits**: two sliders (new/day, practice/day).
- **Voice**: TTS voice selection per target language (if multiple available).
- **Data**: Export all data as JSON; Import (merges or replaces — with confirm); Clear all data (with strong confirm).
- **About**: app version, attributions for Kelly, Wiktionary, ipa-dict.
- **AI key (v2)**: paste an API key for example sentence generation. Stored in IndexedDB.

### 7.7 All-caught-up screen

Shown when the user has finished today's session (no new cards left in budget AND no practice cards due).

- Friendly text: "You're caught up for today."
- Subtle session stats (counts, time spent, ratings breakdown) — informational, not gamified
- Optional **"Push further"** button: lets the user pull additional cards beyond today's limits. Cards pulled this way still go through FSRS normally; no penalty.
- Tab nav remains; user can navigate to Vocabulary / Profile.

### 7.8 Onboarding flow

First launch only.

1. Welcome screen.
2. Pick target language (current options: Swedish).
3. Pick claimed level (with "Not sure? Run a quick assessment" link).
4. (Optional) Run the calibration sweep.
5. Brief intro: "Open the app anytime to practice. Tap + to add your own words." (no carousel; one screen.)
6. Land in Practice with the first card ready.

### 7.9 Visual distinction for user-owned content

User-added entries and overlay content carry consistent visual markers:

- Vocabulary list: `⚝` in the level cell for user-source entries.
- Study card: soft accent stripe at left edge when the card or its overlay is user-owned.
- Word Detail: an explicit "Your entry" / "Your annotations" section header.

## 8. SRS

### 8.1 FSRS via `ts-fsrs`

The library handles all scheduling. Configuration:

- Default FSRS parameters (the 17-parameter weight vector) for new users.
- After ~100 reviews, the user's parameters can be personalised by the library's optimisation routine. This is invisible to the user — it just happens on a background task after sessions.
- Learning steps: enabled by default in `ts-fsrs`. New cards graduate to long-term review after meeting the learning steps' interval requirements.

### 8.2 What FSRS state we keep

Per-skill, per-translation. See `ReviewState` (section 4.4). The library produces `due`, `stability`, `difficulty`, etc.; we persist them after every rating.

### 8.3 Invisibility

The user never sees:

- "Due in X days"
- "Ease factor"
- "Interval"
- "Reviews remaining"
- "Cards in learning vs review"

What the user sees instead:

- Status icons (⚪/🔴/🟡/🟢) on Vocabulary rows and Word Detail
- Progress bar in the Practice screen
- Counts on the all-caught-up screen (session totals only, no scheduling internals)

## 9. Build pipeline (seed generation)

A set of Node scripts under `scripts/seed/` that produce `data/seed-<lang>.json` for each supported language. Run manually; output is checked into source control.

### 9.1 Pipeline stages

1. **Fetch raw sources**.
   - Kelly wordlist for the target language (where available).
   - Wiktionary structured extract via kaikki.org (CC-BY-SA), filtered to the target language.
   - ipa-dict CDN dump for the target language.
   - For Swedish v1: also user's exported apkg file as a higher-priority source (preserves his hand-curated translations, notes, examples).

2. **Join into unified entries**.
   - Match on lemma + POS where possible.
   - Where Kelly and Wiktionary disagree on POS, log and let the cleanup pass decide.
   - Pull IPA from Wiktionary first, ipa-dict as fallback.
   - Pull inflections from Wiktionary conjugation/declension tables, using the per-language key vocabulary the render modules expect (Swedish verbs: `presens`/`preteritum`/`supinum`/`imperativ`; Swedish nouns: `definiteSingular`/`indefinitePlural`/`definitePlural`).
   - Detect noun countability from Wiktionary (the *(uncountable)* / *(usually uncountable)* tags) and set `features.countable = "no"` so the renderer omits the article (e.g. "vatten", not "ett vatten"). Absence of the flag means countable.
   - Pull example sentences from Wiktionary where available.

3. **Heuristic flagging**.
   - Translations containing periods (likely abbreviation expansion bug: *"el. sen"* → *"electricity later"*).
   - Translations dramatically longer than the lemma.
   - Missing POS.
   - Multiple unrelated translations glued together.
   - Output a `flagged` field on each entry.

4. **Sense grouping** for polysemy.
   - If multiple Wiktionary senses map to the *same* primary translation: **merge** into one entry with `subDefinitions: [...]`.
   - If they map to *different* translations: **split** into separate entries, each with a short `disambiguator` (1–3 words).
   - The grouping decision is by surface match on primary translation, then refined by the cleanup pass.

5. **LLM cleanup pass** (Claude Code subagent).
   - A subagent named `seed-cleaner` is defined as a markdown file in `.claude/agents/seed-cleaner.md` with its own system prompt and a constrained tool allowlist (Read, Write).
   - The build script chunks the sense-grouped entries into ~50-entry batches and writes them to `data/intermediate/batches/<n>.json`.
   - You run Claude Code in the repo and ask it to process the batches — Claude Code dispatches each batch to the `seed-cleaner` subagent.
   - The subagent returns structured JSON decisions per entry: `{ keep | fix | drop }` with a reason and proposed fixes.
   - All cleanup work happens inside the Claude Code session under your Claude Code subscription — no separate API key, no separate billing.

6. **Human review**.
   - All `fix` and `drop` entries are presented for confirmation.
   - A random sample of `keep` entries also reviewed.
   - Final decisions are applied to produce the seed.

7. **Output**.
   - `data/seed-sv.json` (and equivalent for each language).
   - `data/sources.json` records source versions/hashes for reproducibility.

### 9.2 Subagent definition

The cleanup logic lives in `.claude/agents/seed-cleaner.md` as a Claude Code subagent. Sketch:

```markdown
---
name: seed-cleaner
description: Reviews vocabulary seed entries for translation errors, abbreviation-expansion bugs, sense-split mistakes, archaic forms, and weak disambiguators. Use when processing data/intermediate/batches/*.json files.
tools: Read, Write
model: sonnet
---

You review batches of vocabulary entries for a language-learning seed dataset.

For each entry in the input batch, decide one of: `keep`, `fix`, or `drop`.

Look for:
- Abbreviation expansion errors (e.g. "el." for "eller" being expanded into "electricity")
- Translations dramatically out of register with the lemma
- Sense splits that should have been merges (when senses share the primary translation)
- Sense merges that should have been splits (when senses translate to distinct words)
- Weak or unidiomatic disambiguators
- Archaic, dialectal, or low-frequency variants that shouldn't be taught at CEFR levels

Return a JSON array, one decision per entry, in the input order.
```

Each batch input has this shape:

```json
{
  "lemma": "sedan",
  "pos": "adverb",
  "candidateTranslations": ["later", "electricity later"],
  "rawSourceLines": [
    { "source": "kelly", "line": "sedan el. sen — later" }
  ],
  "wiktionarySenses": [...],
  "flags": ["translation-contains-period"]
}
```

And the subagent returns:

```json
{
  "lemma": "sedan",
  "decision": "fix",
  "reason": "Translation 'electricity later' is an erroneous expansion of abbreviation 'el.' meaning 'eller' (or)",
  "proposedTranslation": "later",
  "proposedSubDefinitions": ["later in time", "then, subsequently"]
}
```

Decisions are written to `data/intermediate/decisions/<n>.json`. The `apply-decisions.ts` script merges them and queues `fix` / `drop` items for human review in a separate file.

**Workflow in practice.** From the repo root, you run `claude` (Claude Code), then ask it something like: *"Run the seed-cleaner subagent over all batches in `data/intermediate/batches/` and write the decisions to `data/intermediate/decisions/`."* Claude Code dispatches the work serially; you check in afterward. For ~160 batches this takes 20–60 minutes of session time depending on plan limits.

### 9.3 Reproducibility

`scripts/seed/build.ts` is deterministic given the same source versions. Source versions live in `data/sources.json`:

```json
{
  "kelly": { "version": "...", "url": "..." },
  "wiktionary": { "dumpDate": "2025-11-01", "url": "..." },
  "ipaDict": { "commitHash": "abc123" }
}
```

Bumping a source version is a deliberate act; the resulting seed is regenerated and reviewed before being committed.

### 9.4 Fixes live in the inputs, never the output

`seed-<lang>.json` is a **generated artifact**. Every correction to seed data — a wrong gloss, a bad example, an off IPA — must be encoded in a pipeline *input* (a `data/intermediate/decisions/*.json` entry, or a `data/intermediate/examples/*.json` entry), and the seed regenerated *through the pipeline*. Never hand-patch the generated `seed-<lang>.json` (or its `public/` copy). Two invariants must always hold for any fix:

1. **Survives a full rebuild.** Running the full pipeline (`pnpm seed:build`) reproduces the fix, because it lives in an input the pipeline reads — not in the output it overwrites.
2. **Reaches users on release.** The regenerated `seed-<lang>.json` + `version.json` (data + `public/`) are what the release builds and serves; the bumped version triggers seed-sync to update the affected cards **in place, preserving the learner's progress** (§4.2, the overlay model).

A `fix` decision can override `proposedTranslation`, `proposedSubDefinitions`, and `proposedIpa`; curated example sentences are supplied per `kellyId` in `data/intermediate/examples/`. If a field you need to correct has no input hook yet, **add the hook to `apply-decisions`** rather than editing the output — that keeps the "all fixes are reproducible inputs" guarantee intact.

## 10. Runtime enrichment

### 10.1 ipa-dict at runtime

For user-added words not in the seed:

- Fetch `https://cdn.jsdelivr.net/gh/open-dict-data/ipa-dict@<pinned-hash>/data/<lang>.txt` (or equivalent), parse, look up the lemma.
- Cache the parsed dictionary in Dexie on first use so subsequent adds are offline-fast.
- Pin the commit hash; updates are manual via Profile → About → "Refresh dictionary data".

### 10.2 Wiktionary at runtime

Best-effort enrichment for POS, gender, inflections (not IPA — ipa-dict handles that).

- Fetch `https://<targetLang>.wiktionary.org/api/rest_v1/page/html/<lemma>`.
- Set `User-Agent: Yak/0.x (contact: …)` per Wikimedia's request.
- Parse client-side with `DOMParser`.
- Extract:
  - The relevant language section (matches `targetLang`)
  - POS heading
  - Gender markers
  - Inflection / conjugation table (per language)
- Fail gracefully on parse errors — any field that can't be extracted stays blank in the Add flow preview.

A single `WiktionaryClient` module isolates the fetch + parse + fail-soft logic from the rest of the codebase.

Cache successful lookups in Dexie keyed by `(lang, lemma)` with a 30-day TTL.

## 11. AI integration (v2)

Out of scope for v1 but designed for. Sketch:

- User pastes an API key on Profile. Stored in IndexedDB.
- Provider abstraction supports Anthropic and OpenAI from the start.
- On demand from a Word Detail action ("Generate example"), the app sends: lemma, POS, target language, native language, claimed level, 2–3 sample words the user has already encountered (for register matching).
- Response is parsed, shown for user approval, saved as a user-provided example (with an "AI-generated" badge).
- Cache aggressively in Dexie keyed by `(lemma, level, model)`.
- Thumbs-down removes a bad example.

No v1 work. Listed here so the data model and Profile fields accommodate it without future migration.

## 12. Phasing

### v1 (initial ship)

- Swedish ↔ English only
- Stack as specified
- All sections 4–10 implemented
- Onboarding + calibration sweep
- Practice / Vocabulary / Profile screens
- Add flow with best-effort Wiktionary + ipa-dict
- Export/import JSON
- Seed generation pipeline, manually run

### v2

- German, then Spanish, then French (in that order)
- AI example generation
- Apkg import (full)
- Browse screen (separate from Vocabulary, browsing the seed without study-set filter) — only if Vocabulary alone proves insufficient
- Sync/backup (requires backend; not committed)

### v3+

- Curated topic packs (travel, cooking, etc.) as additive content
- Pseudo-words for calibration overclaiming detection
- Listening / cloze skill dimensions (extra `skill` values in `ReviewState`)
- Personalised FSRS parameters surfaced to the user
- Optional gamification (streaks, milestones) — opt-in only

## 13. Open questions

To be settled during implementation, not blocking:

- **Apkg import behaviour**: when the user's apkg has a card the seed already covers, what's the merge policy? Likely same as Add flow seed-match: flag the seed entry and create an overlay with the user's notes.
- **TTS voice fallback**: when the browser has no voice for the target language, what's the UX? Hide audio button silently, or show a "voice unavailable" tooltip?
- **First-launch performance**: bundling the Swedish seed (~8000 entries) inflates initial download. Consider lazy-loading seed JSON on first session start, with a brief loading screen.
- **Service worker**: PWA offline-first means the seed JSON should be in cache from first launch. Service worker config TBD.
- **A11y**: status icons (🟢/🟡/🔴/⚪) need text equivalents for screen readers. Color-blind palette consideration for the rating buttons.

## 14. File layout (working assumption)

```
yak/
├── package.json
├── pnpm-lock.yaml
├── vite.config.ts
├── tsconfig.json
├── CONTRIBUTING.md
├── SPEC.md                          (this file)
├── data/
│   ├── seed-sv.json
│   └── sources.json
├── scripts/
│   └── seed/
│       ├── build.ts                  (top-level orchestrator)
│       ├── fetch-kelly.ts
│       ├── fetch-wiktionary.ts
│       ├── fetch-ipa-dict.ts
│       ├── fetch-apkg.ts
│       ├── join.ts
│       ├── flag.ts
│       ├── sense-group.ts
│       ├── batch-for-cleanup.ts      (writes data/intermediate/batches/)
│       └── apply-decisions.ts        (reads data/intermediate/decisions/)
├── .claude/
│   └── agents/
│       └── seed-cleaner.md           (the cleanup subagent)
├── src/
│   ├── main.tsx
│   ├── app.tsx
│   ├── db/
│   │   ├── schema.ts
│   │   └── queries.ts
│   ├── srs/
│   │   ├── fsrs-adapter.ts
│   │   └── session-composer.ts
│   ├── lang/
│   │   ├── sv/
│   │   │   └── render.ts
│   │   ├── en/
│   │   │   └── render.ts
│   │   └── index.ts
│   ├── enrichment/
│   │   ├── ipa-dict-client.ts
│   │   └── wiktionary-client.ts
│   ├── components/
│   │   ├── PracticeScreen/
│   │   ├── VocabularyScreen/
│   │   ├── ProfileScreen/
│   │   ├── AddSheet/
│   │   ├── WordDetail/
│   │   └── CalibrationSweep/
│   └── styles/
│       └── tokens.css
└── tests/
```

---

*End of spec.*

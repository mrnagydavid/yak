# Swedish seed — changelog

The human "why" log for the shipped Swedish wordlist, on top of `git blame`. The source of truth is
`wordlist.json` (hand-edited); `pnpm seed:pack` builds the shipped `seed-sv.json` + `version.json`.
Add a dated entry here whenever you change content. Newest first.

See `SNAPSHOT-PIPELINE-DESIGN.md` for the pipeline; §7 has the editing recipes.

## 2026-07-12 — Sense-disambiguating translations + `trä` cleanup

`version` `sv-2026-06-01-53e12ffa` → `sv-2026-06-01-59fbbd9a`. Count unchanged (8347).

**Translation clarity.** Two nouns whose bare English translation was ambiguous now name their sense in
the translation itself: `för` (noun) `bow` → `ship's bow`, and `cup` (noun) `cup` → `sport's cup`. Both
now render a distinctive production prompt (`a ship's bow`, `a sport's cup`), so they no longer collide
with their look-alikes and their disambiguating glosses are dropped as redundant. Ripple fixes to the
now-solo partners: `båge` loses its `arc, weapon` gloss (sole producer of `a bow`), `cup` (drinking
vessel `kopp`) keeps the shared `cup#0` group but drops the now-redundant `drinking vessel` gloss.

**`trä` cleanup.** `trä` is the material *wood* only; its former `tree (archaic, poetic)` sub-definition
was dropped (too marginal to teach — `träd` is the word for tree). Stays `wood`, `enUncountable`.

`version` `sv-2026-06-01-924aa1ef` → `sv-2026-06-01-53e12ffa`. Count 8319 → 8347 (28 additions).

New authored field **`boost`** (integer, higher = introduced earlier) orders the new-card queue within a
CEFR band, so a Beginner (`below-A1`, new band = A1) meets high-value vocab first instead of the raw
alphabetical/arbitrary order (`decimeter`, `arton`, place names…). Boost only affects a word's FIRST
introduction (the composer's `fresh` pool); practice/calibration order is untouched, so day-to-day
variance is preserved once a word has SRS state.

Curated **top-down**: generated ~200 words+phrases a learner needs first for everyday/subtitle
comprehension (excluding numbers & personal pronouns; interrogatives kept), then mapped onto the seed.
Result — 206 A1 boost items in 3 tiers (3=survival/greetings/core function words, 2=core, 1=useful):

- **166** existing A1 words tagged `boost`.
- **12 re-leveled into A1** (+boost): `förlåt` (C2→A1), `hejdå`/`hallå`/`jaså` (C1→A1), `okej`/`ursäkta`/
  `hungrig` (B1→A1), `snäll`/`välkommen`/`kaffe`/`vart` (A2→A1), `för` conj "because" (A2→A1). These are
  spoken/politeness words Kelly corpus-frequency banded too high (written corpora under-represent them).
- **3 words added** (A1): `snälla` (please), `varsågod` (here you go), `pengar` (money — the seed only
  had `peng` "coin").
- **25 set phrases added** (`pos: phrase`, A1): greetings & survival lines — `Hur mår du?`,
  `Vad heter du?`, `Jag förstår inte.`, `Det ska ordna sig.`, `Vad kostar det?`, …

## 2026-07-11 — English-article countability pass + targeted fixes

`version` `sv-2026-06-01-70dbed97` → `sv-2026-06-01-924aa1ef`. Count 8321 → 8319 (two deletions).

**Targeted fixes.** `utland` → uncountable (was "an abroad"). Dropped two interjection cards duplicating
a plain word — `gud` "oh God!" (kept noun `gud` "a god"; its example had been the exclamation, replaced
with `Zeus var en grekisk gud.`) and `välkommen` "welcome!" (kept the adjective). Respelled `symptom` →
`symtom` (modern SAOL form; IPA/`seedKey`/`gender` untouched, progress preserved).

**Countability.** Reworked which nouns render bare vs "a/an X" on the English side; settled at **773
`enUncountable` cards** (from 632). The durable rule, after several swings (see git history if curious):
**this trainer teaches, it is not a dictionary — mark a card uncountable only when "a/an X" is wrong in
the *unmarked default* sense it teaches.** "Can I construct 'a X'?" is the wrong test — type-of
("a wine"), instance-of ("a success"), serving-of ("a coffee"), and exclamatory ("what a shame")
readings article almost anything without making the default sense countable. Because each *sense* is a
separate Swedish card, the count reading usually already lives on its own card: `ordning` "order"
(tidiness, bare) vs `order`/`befallning` "an order"; `skam` "shame" (bare) vs `synd` "a shame, pity".

Reconciliation: re-articling shifts prompt collisions, so `audit-gloss` clashes were each a mass Swedish
word colliding with a countable sibling — fixed by baring the mass member (`byggande` vs `byggnad`,
`erfarenhet` vs `upplevelse`, `andedräkt` vs `andetag`, `ordning` vs `order`, …); now-redundant glosses
auto-removed. `pnpm test` green (221); `audit-gloss` HARD-clean.

Deferred (deliberately wrapped up here): the borderline middle-ground abstracts (`success`, `criticism`,
`development`, `domestic policy`…) were left **countable** rather than swung back to uncountable — a
consistent "err uncountable" re-sweep of those is a possible future pass. The Swedish side
(`svUncountable`/`svProper`) is untouched but was built with an older rule, so it likely wants the same
correction. `;`-multi-sense translations (`tur` "luck; turn") still bare the dominant sense (whole-card
flag).

## 2026-07-11 — Gloss sweep, stage 3: resolve the flagged prompts + harden the checker

Curated all 488 collision neighborhoods (~903 flagged slots) from the Stage-1+2 soft queue. Every
ambiguous production prompt is now resolved by the mechanism that fits it — **grouping** true synonyms
into one "N ways to say it" card (including gender/number forms like `den`/`det`/`de` "the"), or a short
**everyday-cue gloss** — with **zero translation edits**. (A first, aggressive attempt that rewrote 300+
primary translations to force self-clarity — e.g. `inleda "begin, introduce, open" → "kick off"` — was
reviewed and reverted: a primary translation IS the recognition-taught meaning, so it is edited only as a
constrained, faithful last resort, never to game the checker.) Glosses use **concrete cues, not grammar
labels** (most users aren't native English speakers): `dig → as in "I saw you"` (not "object"),
`sin → "his own"` (not "reflexive"). 310 field edits, all on `sense.key` / `sense.gloss` /
`altMeanings[]` only — **0 forbidden-field changes**; `seedKey`/`meaningKey`/`examples` untouched, so
learner progress is preserved. `version` `sv-2026-06-01-d3a105af` → `sv-2026-06-01-70dbed97`.

Result: **POS-tag glosses 155 → 0, echo glosses 88 → 0**, and both are now **HARD / CI-gated** in
`audit-gloss.mjs` — joining the existing redundant-gloss and card-clash checks ("no two production cards
render an identical prompt+gloss", verified 0 across 894 cards). The now-dead `styck` entry was removed
from the missing-gloss allowlist. The **missing-gloss** count rose 707 → 754 and is left **report-only on
purpose**: it is the intended *floor* — the single most common/default word for a concept (`och`, `få`,
`från`) and self-glossing multi-token translations (`inleda` = "begin, introduce, open") are correctly
left plain; driving it to 0 would mean over-hinting. `pnpm test` green (221). Full write-up:
`data/scratch/sv/stage3-summary.md`.

## 2026-07-10 — Gloss sweep, stage 1+2: remove redundant glosses + rebase the checker

Removed **1,102 redundant production glosses** and rebased the gloss checker onto a correct model of when
a gloss is actually needed. The old pipeline assigned glosses from a coarse first-token "concept"
(`normTr`), which both over-fired (POS homonyms the article separates — `to feed` vs `a feed` carried
`feed (verb)`) and under-fired. The real unit of ambiguity is the **articleized synonym token** the
learner sees: split a translation on `,`/`;`, articleize each token exactly as `src/lang/en/render.ts`
renders a prompt, and two producers collide only when those token-sets intersect. A slot is **self-clear**
when it has a token unique to its sense (the article on `a second` vs the bare `second`, or the `only` in
`just, only`) and needs no gloss; it is **bare-ambiguous** when every token it shows is contested.

New `scripts/seed/lib/glossModel.mjs` is the single definition (checker + deletion share it; guarded by a
parity test against `en/render.ts`). `audit-gloss.mjs` is rebased with two tiers: **HARD** (CI-gated) —
a self-clear slot carries no gloss; **SOFT** (report-only) — a bare-ambiguous slot should carry a real,
non-POS-tag, non-echo gloss. The deletion (`delete-redundant-glosses.mjs`) removes only `gloss`, keeping
every grouping key, so synonym groups are untouched. `version` `sv-2026-06-01-9bb3a7d4` →
`sv-2026-06-01-d3a105af`; the diff is gloss-only (seed-sync applies 1,102 gloss-only updates, progress
preserved via `(seedKey, meaningKey)`). Verified: **0** of the 1,102 removals sit on a colliding prompt,
and **0** card-level clashes across all 7,604 production cards (no two cards render an identical
prompt+gloss). Review artifacts written to `data/scratch/sv/` by `diff-wordlist.mjs` /
`review-ambiguous.mjs`.

What we deliberately did **not** do:
- **Didn't touch translations, or improve/add any gloss.** Stage 1+2 is deletion only. The 950-item soft
  queue (707 bare-ambiguous with no gloss, 155 POS-tag, 88 echo) is left for **stage 3** — the curation
  pass that groups synonyms, sharpens translations, and writes real glosses (usage-frames included).
- **Didn't add the clash invariant to CI.** "No two cards share a prompt+gloss face" is 0 today and would
  be a cheap hard check, but it's deferred pending a decision.
- **Didn't flip the soft checks to hard.** They gate CI only once stage 3 drives them to 0.

## 2026-07-10 — Uncountable / proper-noun article pass (both languages)

Marked nouns as uncountable or proper so they stop rendering a spurious indefinite article, on both
the Swedish and English sides. Added the authored field `svProper` (symmetric to `enProper`); the
Swedish renderer now bares proper nouns (`islam`) and parenthesises uncountables (`(ett) vatten`,
keeping the en/ett gender cue). Done as a hand-curated closed set (languages, religions, holidays, core
mass nouns) plus an agent sweep over candidate nouns (SNAPSHOT-PIPELINE-DESIGN.md §11). Also fixed two
adjectives mis-tagged as nouns (`sned` deleted as a duplicate, `kvitt` → adj) and a vowel-dropped
inflection typo (`upphetsning`). `version` `sv-2026-06-01-86b7078c` → `sv-2026-06-01-9bb3a7d4`; not
content-neutral, so seed-sync updates the changed entries in place (progress preserved).

What we deliberately did **not** do:
- **Didn't mark a word uncountable when it has any everyday countable sense** (prefer-countable).
  Beverages keep their article ("a coffee" / "en öl"), as do materials with a count sense (`glas`,
  `papper`).
- **Didn't treat weekdays as proper, though months are.** "On a Friday" / "på en fredag" is idiomatic,
  so weekdays stay countable while `maj` renders bare.
- **Didn't un-mark a mass noun just because the seed lists a plural.** A distinct plural is usually a
  rare "types-of" form on a genuine mass noun (`forskningar`, `salter`); reverting would wrongly produce
  `en information` / `en socialism`. Instead the card blanks the plural column for uncountables.

## 2026-07-09 — Migrate to the snapshot pipeline (content-neutral)

Replaced the layered seed pipeline (immutable base + ordered correction layers + reducer) with a
single hand-editable snapshot, `wordlist.json`, packed into the shipped seed by `scripts/seed/pack.mjs`.
See `SNAPSHOT-PIPELINE-DESIGN.md`. The layered machinery (base.json, layers.json, layers/ with the raw
LLM `runs/` ledgers, and the batch/compile/stale scripts) is archived under `legacy/` and
`scripts/seed/legacy/` — still in git, still the escape hatch for a future bulk re-curation.

**Content-neutral.** `wordlist.json` is HEAD's shipped seed with only the two derived fields (`h`,
`ipaAmbiguous`) stripped; `pack` re-derives them and re-serializes every entry through one canonical
key order. The only effect: **6** entries (`innan, nära, tysk, liberal, hyra, hosta`) whose key order
differed from that canonical order rehash — their decoded content is byte-identical. No values changed,
no adds, no deletes.

`version`: `sv-2026-06-01-4898e37e` → `sv-2026-06-01-86b7078c` (the 6 key-reorder rehashes). Verified
against the frozen `4898e37e` baseline: **0 content diffs**, exactly those 6 `h`-only changes. On a
learner's device seed-sync runs once, applies 6 in-place content-identical updates, 0 adds, 0 deletes —
progress preserved (matched on `(seedKey, meaningKey)`).

Also this migration (not content changes to the seed):
- Reworked `audit-gloss` to read the shipped seed's own labels instead of the retired sense layer. It
  detects concepts by first token (`groupConcepts`), which is a *lossy* reconstruction of the curated
  sense partition — a gloss whose label english is broader than the phrase (e.g. `of course, you know,
  after all#1` on "of course", whose "as you know" sibling isn't in the shipped seed) is legitimate, so
  the single-sense-with-gloss check fires only when the label english equals the phrase. See §6.1.
- **`styck` "piece" adjudication:** `styck` produces "piece" with no grouping label, colliding with
  `bit`/`stycke` "piece". It is a genuinely distinct sense (the counting unit "apiece / per unit", "10
  kronor styck") that happens to be string-identical — the same semantic line as `filosofi` /
  `article (grammar)`, which no mechanical rule can separate from "should be grouped". Recorded as an
  explicit human verdict in `audit-gloss`'s `BLANK_LABEL_ALLOWLIST` (so the check stays hard: a *new*
  ungrouped producer still fails CI) rather than forcing a false merge. Grouping it — or giving it its
  own gloss — is deferred content work, out of scope for this content-neutral migration.

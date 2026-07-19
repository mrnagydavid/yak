# Swedish seed — changelog

The human "why" log for the shipped Swedish wordlist, on top of `git blame`. The source of truth is
`wordlist.json` (hand-edited); `pnpm seed:pack` builds the shipped `seed-sv.json` + `version.json`.
Add a dated entry here whenever you change content. Newest first.

**Keep entries compact — record the _reasoning_, not the content.** Each entry is tied to its commit,
so `git show` already carries the exact words, translations, examples, and seedKeys; don't restate
them. Capture only the "why" (and any non-obvious consequence, e.g. a gloss going redundant) — roughly
one line per word, plus the `version` from→to + count line as the anchor.

See `SNAPSHOT-PIPELINE-DESIGN.md` for the pipeline; §7 has the editing recipes.

## 2026-07-19 — split `föda` into "feed" / "give birth"

`version` `sv-2026-06-01-7075cbea` → `sv-2026-06-01-eb335d9d`. Content-only (count 8503).

- **`föda`** (verb) / **`mata`** — `föda` "feed; give birth" shared the group key `feed; give birth#0`
  with `mata` ("feed"), so they collapsed into one "2 ways to say" card whose prompt read "to feed; to
  give birth" — misleading, since `mata` never means "give birth". Split `föda` into a primary "feed"
  (grouped with `mata` under the renamed `feed#0`) and a promoted standalone "give birth" (its own
  example, no group), so "give birth" is drilled on its own and only "feed" pairs with `mata`.

## 2026-07-19 — `må`: promote "feel" over the archaic "may"

`version` `sv-2026-06-01-545e1c29` → `sv-2026-06-01-7075cbea`. Content-only (count 8503). Closes the
`må` recuration deferred in the entry below.

- **`må`** — main was the dated optative "may" (rendered "to may"); promoted the everyday "feel/be
  well" sense (previously a subdefinition) to main, demoted "may" to a reference-only subdefinition
  with an inline optative example (a bare subdef can't hold a structured example), and gave the "feel"
  sense its own example. Also re-conjugated it: the old inflections were the defective modal (`må`,
  `måtte`, no supine/imperative) — the "feel" verb is full (`mår`, `mådde`, `mått`, `må`), and the old
  presens `må` even contradicted the `Hur mår du?` example. The new "feel" card collides with
  **`känna`** ("feel, sense"): `må` is the specialized sense so it takes the gloss, while `känna` stays
  plain as the default word for both "feel" and "sense" (its cousin `ana` already glosses the "sense"
  split). This flips `känna` from self-clear to bare-ambiguous (missing-gloss floor +1) — the intended
  default-plain behavior, not a regression.

## 2026-07-19 — defective/modal verbs: no infinitive marker

`version` `sv-2026-06-01-bbd7b403` → `sv-2026-06-01-545e1c29`. Content-only (no count change). Needs the
new `svNoInfinitive` / `enNoInfinitive` render flags (→ `features.infinitive: 'no'`; renderer omits
`att` / `to`).

- **`torde`** — was rendering `att torde` / `to probably is`: it's a defective verb (no infinitive) and
  its gloss was a finite phrase. Flagged `svNoInfinitive` + `enNoInfinitive`, and tightened the gloss to
  the core epistemic reading (drop the finite "is/should be" that also read as false synonymy with `borde`).
- **`måste`** — same defect (finite-only, no infinitive): `svNoInfinitive` + `enNoInfinitive` kill
  `att måste` / `to must`.
- **`skola`** (verb) / **`böra`** — `enNoInfinitive` only: English modals have no infinitive, so `to shall`
  / `to should` are wrong; the Swedish `att` is kept (`att skola` also disambiguates from the noun `skola`).
- Deferred: **`må`** needs a full recuration (promote the everyday "feel/be well" sense over the archaic
  optative "may", with its own inflections) — a translation task, not a render flag.

`version` `sv-2026-06-01-df4a1940` → `sv-2026-06-01-bbd7b403`. Count 8504 → 8503 (removed `övrigt`).

- **`insyn`** — marked `svUncountable`; abstract mass noun.
- **`övrigt`** — removed. Only the neuter of the adjective `övrig`, not a manner adverb (no "in an
  övrig way" reading, unlike the genuine `stor`→`stort` pattern), so it duplicated `övrig`; the real
  adverbials `i övrigt` / `för övrigt` already exist.
- **`pjäs`** — dropped the archaic "man" (chessman) from the game-piece meaning, keeping the clearer
  etymological "piece"; the `game piece` gloss still disambiguates it.
- **`man`** / **`karl`** — dropped their `adult male` gloss: with `pjäs` no longer producing "man" the
  concept is a plain synonym pair, so disambiguation is redundant (single-label ⇒ no gloss).
- **`någon som helst`** — broadened translation to add the "anyone" pronoun reading (pure "anyone" is
  `vem som helst`); fixed an example that used `ingen … som helst` and lacked the headword.
- **`vana`** / **`besättning`** — gave each a main-meaning example; both previously illustrated only a
  subdefinition sense on the production card.

## 2026-07-16 — `stolthet` countability

`version` `sv-2026-06-01-8f51ab75` → `sv-2026-06-01-df4a1940`. Content-only (no count change).

- **`stolthet`** — added `svUncountable` so it renders `(en) stolthet`. The emotion "pride" is a mass
  noun in Swedish ("Hon kände stolthet", not "en stolthet"); a `-het` abstraktum like the already-marked
  `ödmjukhet`/`ärlighet`. Entry already had plurals `-` and `enUncountable`, so this fixes an
  inconsistency. Translation `pride` left as-is (correct; the "source of pride" sense is secondary).

## 2026-07-15 — Countability fixes (kyla, samtid, påverkan/inverkan/inflytande) + etta gloss

`version` `sv-2026-06-01-16521744` → `sv-2026-06-01-8f51ab75`. Content-only (no count change).

- **`kyla`** — added `svUncountable` so it renders `(en) kyla` (mass noun, plural `-`). English
  `cold, coldness` already `enUncountable`; correct (the temperature/coldness sense, not the countable
  illness "a cold").
- **`samtid`** — added `svUncountable` + `enUncountable`. `(en) samtid`; English drops the awkward
  article → `present time, contemporary era` (both used as mass/abstract here, not "a present time").
- **`etta`** — retranslated `one` → `the number one`. The bare noun `one` articleized to the confusing
  `a one`; `the number one` renders cleanly and unambiguously teaches the numeral-noun. Digit/first
  year/first gear/studio-apartment nuances stay in `subDefinitions`.
- **`påverkan` / `inverkan` / `inflytande`** (the `influence#0` synonym card) — marked all three
  `enUncountable` so the shared production card renders `influence` consistently (the abstract
  sway/impact sense is uncountable; "an influence" read wrong). Added `svUncountable` to `påverkan`
  and `inverkan` (mass nouns, plural `-`) → `(en) påverkan` / `(en) inverkan`. `inflytande` keeps its
  real Swedish plural (`inflytanden`), so it stays `ett inflytande`. This also lifts the three out of
  the missing-gloss floor in `audit-gloss` (their bare `influence` token is now sense-unique).

`version` `sv-2026-06-01-e5a0454d` → `sv-2026-06-01-16521744`. Count 8399 → 8504 (+105).

Also lowered `handduk` (towel) C1 → A2 (Kelly-band artifact; an everyday word), which drops
`Att kasta in handduken.` from C2 to its correct B1 floor.

Higher-level counterpart to the A1 "survival kit" phrases: 105 authentic Swedish ordspråk/talesätt/idiom
(`Ingen ko på isen.`, `Att gå som katten kring het gröt.`, `Nu har du skitit i det blå skåpet.`, …), all
`pos: phrase`, no `boost`. They behave like any word — both directions, count toward level-up and the
progress bars.

Each phrase carries two English fields (new `wordForWord` on `Entry`): `translation` is what the saying
MEANS (the English equivalent, or the plain meaning when there's no equivalent — e.g. *There's no bad
weather, only bad clothing.*), and `wordForWord` is the literal reading, shown as a quiet italic line
under the meaning on the RECOGNITION reveal only. Both are capitalised as a sentence when the saying is
one and lowercased as a gloss when it's a phrase-fragment (`to throw in the towel`). `wordForWord` is
omitted when it would merely restate the meaning. StudyCard also renders phrase prompts smaller (they're
sentences, not headwords) and hides the Wiktionary link for phrases (most have no standalone page).

Levelling is DERIVED, not hand-picked per whim: each phrase sits one CEFR step above the hardest word it
contains that we actually teach (the composer surfaces a seed entry as a NEW card at `cefr === level+1`,
and a learner reaches level L only by graduating every word ≤ L — so this floor makes a phrase appear
only once its known words are being learnt). Because idioms carry their difficulty in vivid words we
don't teach (`björntjänst`, `hjärterum`, `nattmössan`), the derived floor alone underlevels many; an
editorial `cefr` override in the source raises those (never below the floor). Distribution: B1 38, B2 28,
C1 14, C2 26.

Source of truth for the sayings is `scripts/seed/phrases/proverbs-sv.json`; `pnpm seed:build-phrases`
(`--write`) upserts them into `wordlist.json` by lemma (idempotent; leaves the A1 survival phrases alone),
then `pnpm seed:pack`. A `tests/seed.test.ts` guard enforces the one-above-hardest-word floor (A1 survival
phrases exempt). `pnpm test` green (245).

## 2026-07-13 — CEFR re-leveling: body, clothing, food, kitchenware

`version` `sv-2026-06-01-a7632a6a` → `sv-2026-06-01-e5a0454d`. Count unchanged (8399).

Continuation of the animals/plants pass above — same root cause (Kelly frequency band ≠ pedagogical
level) and same lowering-only rule, applied to four more badly over-banded everyday domains (forks,
oranges, elbows, apples were all C1/C2). Common/idiom-anchor nouns → A2, secondary → B1; internal
organs settled at B1–B2. Already-low common words (`hjärta`, `hjärna`, `blod`) left where they are —
raising them to "match" an organ band would only delay teaching them. Levels follow standard
SFI/CEFR-reference expectations. Homonyms were disambiguated by pos+translation so only the domain
sense moved (`led` joint not queue, `panna` forehead not pan, etc.). `pnpm test` green (244).

## 2026-07-13 — CEFR re-leveling: everyday concrete nouns (animals, plants, trees)

`version` `sv-2026-06-01-b48859e5` → `sv-2026-06-01-a7632a6a`. Count unchanged (8399).

**Re-leveled 45 everyday concrete nouns down to A2/B1.** The `cefr` field is Kelly's written-corpus
frequency band, not a pedagogical level — the distribution is a near-perfect sixth per band
(1376–1430 each), so any concrete noun people rarely *write* gets over-banded. Same failure mode the
2026-07-12 boost pass fixed for spoken/politeness words (`förlåt` C2→A1, `hej då` C1→A1); this pass
applies it to nature vocabulary. Trigger: an upcoming proverbs/sayings feature that gates a saying on
the max CEFR of its component words — `flitig som ett bi` ("busy as a bee") would have gated at C2
because `bi` (bee) alone was C2.

Rule: common everyday / idiom-anchor nouns → **A2**; exotic-or-secondary → **B1**; genuinely
literary words (`gryning`/`skymning` dawn/dusk) and homonyms whose seed sense isn't the nature word
(`bi` adv "by", `val` "choice", `bok` "book", `pil` "arrow") left alone.

`cefr` is an authored field and not a progress key; seed-sync matches on `(seedKey, meaningKey)`, so
these are in-place updates with learner progress preserved. `pnpm test` green (244).

## 2026-07-13 — `besläktad` comparison fix

`version` `sv-2026-06-01-0fd3a636` → `sv-2026-06-01-b48859e5`. Count unchanged (8399).

**`besläktad` comparison corrected.** Its `komparativ`/`superlativ` were `närmre`/`närmst` — `nära`'s
forms, clearly a bad merge. `besläktad` ("related") is a participle adjective that compares
periphrastically, so it's now `mer besläktad` / `mest besläktad` (matching `begränsad` et al.). Surfaced
while building the new irregular-adjective Practice+ drill, which excludes periphrastic adjectives — this
one was masquerading as irregular.

## 2026-07-13 — Quantity/place fixes + European countries

`version` `sv-2026-06-01-59fbbd9a` → `sv-2026-06-01-0fd3a636`. Count 8347 → 8399 (+52).

**Deleted `förhand`.** The standalone noun (`advantage, upper hand`) isn't worth teaching on its own —
it only really lives in the fixed expression. Replaced by a new phrase `på förhand` =
`beforehand, in advance` (B2, `Tack på förhand!`). `fördel` is now the sole producer of `advantage#0`.

**`våning` meaning flipped.** Was `apartment` (main) + `floor, storey` (sub); now `floor, storey` (main)
+ `apartment, flat` (sub), matching the more basic meaning. It now shares the `floor` concept with
`golv`, so both got labels: `golv` = `floor#0` gloss `the surface you walk on`; `våning` = `floor#1`
(self-clear via its `storey` token, no gloss). Added a storey-sense example.

**`tiotal`** translation `around ten, some ten` → `around ten` (dropped the ungrammatical "some ten");
sub-def split into `tens` + `decade (the 1910s, 2010s)`.

**Uncountable flags** (drop the auto-added "a/an" on quantity/direction nouns): `tiotal`, `hundratal`,
`tusental` (`enUncountable`); `höger` noun `right side` (`enUncountable`); `spridning` (`enUncountable`
+ `svUncountable`). `miljontals` needed nothing — it's an adverb (`millions of`).

**European countries (A2).** Added 29 missing European country names (`pos: other`) plus a nationality
adjective (`-sk → -skt/-ska`) wherever it was absent. Country names identical in both languages (Finland,
Portugal, Montenegro, Kosovo, Belarus, Malta) are omitted — no vocab to learn — but their adjectives are
kept. No IPA (left for enrichment). Micro-states omitted as low-value at A2.

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

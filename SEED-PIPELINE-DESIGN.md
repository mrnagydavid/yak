# Seed pipeline — redesign

> Self-contained design doc. Assumes no prior context. Audience: a tech PM (and a future
> Claude Code session that will implement it). Goal: a seed pipeline that is **re-runnable,
> stable, legible at a glance, and never loses expensive LLM work** — fixing the recurring
> "a change disappeared again" class of bug at the root instead of with another guard.
>
> Supersedes `SEED-MEANING-LIST-PLAN.md`. That doc planned a one-off content pass to make the
> meaning lists consistent. This redesign makes that a *standard* targeted re-curation (§4.6) instead
> of a bespoke plan, and treats it as **deferred content work, out of scope for this refactor** (§7).
> The refactor itself is **seed-neutral**: when it's done the rebuilt list is byte-identical to today's.

---

## 1. TL;DR

The architecture is sound and stays. One good idea — *immutable base + correction layers, keyed
by a stable id, reduced to the final list* — grew **five incompatible dialects**, and the seams
between them leak. The fix is four moves:

1. **One overlay format, one declared precedence** (a manifest file, not filename ordering).
2. **Commit the LLM's raw work and read from it** (stop storing it only on a laptop).
3. **The LLM reads a stable, frozen input + carries a staleness stamp** (so we know exactly
   which words need a fresh pass, and never silently re-run the whole sweep).
4. **Each field is owned by one layer wholesale** (the reducer never merges two layers' opinions
   of the same field).

Nothing is thrown away. The base, the stable id, the reproducibility test, and the per-language
render contracts all survive.

---

## 2. How the seed is built today (plain language)

The shipped wordlist `data/seed-sv.json` is a **generated file**. It is built like this:

```
big dictionary dump  ──fetch──▶  raw files  ──join──▶  base.json (the candidate wordlist)
                                                            │
   correction layers (LLM passes + hand fixes) ────────────┤
                                                            ▼
                                            reduce ──▶  seed-sv.json (shipped)
```

- **The base** (`data/intermediate/candidates.json`) is one row per word: lemma, part of speech,
  level, a first-guess translation, forms, pronunciation, examples. It is committed, so day-to-day
  work never touches the 350 MB dump or the network.
- **The correction layers** are sets of small JSON records, each keyed by a stable word id
  (`kellyId`). They say things like "fix this translation", "this word has these meanings",
  "use this example sentence", "drop this duplicate".
- **The reducer** (`scripts/seed/apply-decisions.mjs`) reads the base, applies the layers, and
  writes the shipped list.

**What's genuinely good and stays:**
- One immutable base + stacked corrections is the right pattern.
- The output is fully regenerable from committed inputs, and a test proves it
  (`tests/seed-reproducible.test.ts`). Most data pipelines can't claim that.
- The giant dump is already off the critical path (the base is committed).

---

## 3. What actually breaks (and the evidence)

| # | Weakness | Symptom seen in the repo |
|---|----------|--------------------------|
| 1 | **Expensive LLM output isn't in version control.** The raw per-batch curator/sense outputs are gitignored; only a *merged* summary is committed. | If a merge or re-batch goes wrong, the raw judgment is gone — it lives only on the laptop. Root cause of "we lose LLM results." |
| 2 | **The LLM reads the *output*, not a stable input.** Each quality pass batches off the freshly-built wordlist. | The input the LLM saw is a moving target. Re-batching after any change renumbers batches; stale per-batch files linger and get merged back by "last file wins" → silent revert/resurrection. `tr-batches/resurfaced.json` is the fossil. |
| 3 | **Precedence is encoded in filenames.** Inside `decisions/`, the alphabetically-last file wins — hence `zz-` prefixes. | A later pass silently revived 3 words an earlier pass had dropped; an integrity test had to be bolted on to catch it. |
| 4 | **One field (the meaning list) is written by two layers that never reconcile.** | The entire expensive translation-curation pass was triggered *just* to clean up this inconsistency. |
| 5 | **No staleness signal.** Nothing records "this word changed underneath its last LLM pass." | The only options are "re-run the whole sweep" (expensive) or eyeball it. |
| 6 | **`intermediate/` is an undated graveyard of one-off campaigns** (`b2-`, `gap-`, `mop`, `sd-`, `pos-`, `zz-`, `redundant`, `resurfaced`, `*-changes.txt`). | Names record *which patch run* made them, not what they mean or how they rank. No index; can't tell live inputs from dead scratch. |

> **Diagnosis:** #1–#3 are the same disease. The older passes (cleaner, examples) already commit
> their files and read from the base — the *good* pattern already exists in the repo. The two newer
> LLM passes (translation, senses) were built differently and don't follow it. The redesign makes
> every layer follow the good pattern.

`corrective-changes.txt` in the repo literally documents a cleanup of *"4 recovered pilot fixes +
the 116-entry redundant-list cleanup"* — i.e. a past session spent real effort recovering from
exactly these failure modes.

---

## 4. The target design

### 4.1 Principle

> **The base is immutable. Corrections are stacked layers with a single, declared precedence.
> Every layer owns specific fields and writes them wholesale. The LLM's raw answers are an
> append-only ledger in git; what ships is a deterministic compile of that ledger; a staleness
> report tells us exactly which words need re-curation.**

### 4.2 Directory layout (before → after)

Today: everything lives flat under `data/intermediate/`, base + layers + merged files + dead
scratch all mixed together, layer order implied by filenames.

Target (per-language, ready for the second language):

```
data/
  sources.json                     # provenance of the raw sources (unchanged)
  seed/
    sv/
      base.json                    # the join output (today's candidates.json). Immutable.
                                    #   Regenerated ONLY on a dump bump (rare/never).
      layers.json                  # ★ THE MANIFEST — the ordered list of layers + field ownership.
                                    #   This file *is* the precedence. No filename ordering anywhere.
      layers/
        10-cleaner/                # fix missing/definition-like translations on flagged words   (LLM: seed-cleaner)
        20-pos/                    # fix part-of-speech-mismatch glosses                          (LLM: seed-cleaner)
        30-subdef/                 # tidy sub-definitions                                         (LLM: seed-cleaner)
        40-translation/            # main translation + complete meaning list                    (LLM: translation-curator)  ← active quality pass
        45-split/                  # split a word's meanings → primary / promoted / reference     (LLM: split-curator)
        50-senses/                 # group synonyms into senses; write production glosses         (LLM: sense-partitioner + gloss-curator)
        60-examples/               # sense-specific example sentences for ambiguous words        (LLM: example-writer)
        90-manual/                 # human overrides — always win
      token-synonyms.json          # curated token-overlap merges / keep-separate (read by groupConcepts). See §4.8.
      seed-sv.json                 # generated output (committed, shipped)
      version.json                 # tiny file the app polls to decide whether to re-download
    scratch/                       # gitignored: batch files, working dumps. Reproducible, disposable.
```

Rules that make this legible:

- **The folder number is the precedence.** Higher number = applied later = wins. Gaps of 10 leave
  room to insert a layer without renumbering.
- **Layer folders are the only inputs the reducer reads.** No top-level merged files that can drift.
- **Anything disposable lives in `scratch/` and is gitignored.** If it's committed, it's a real
  input; if it's in `scratch/`, it's regenerable. No more guessing.
- **No `zz-`, no date-suffixed campaign names, no `*-changes.txt` clutter.** An override goes in a
  *higher layer*, never a `zz-` file in the same folder. (Change reports, if wanted, are printed to
  the console or written to `scratch/`.)

### 4.3 The manifest (`layers.json`) — the single source of precedence

One entry per layer, top of file = applied first (lowest precedence). Example:

```jsonc
[
  { "id": 10, "name": "cleaner",     "kind": "llm",   "agent": "seed-cleaner",
    "produces": ["translation", "subDefinitions", "ipa"],
    "input": "base" },

  { "id": 40, "name": "translation", "kind": "llm",   "agent": "translation-curator",
    "produces": ["translation", "subDefinitions", "enUncountable"],
    "input": "base + layers below" },           // what the LLM is shown == its frozen input

  { "id": 50, "name": "senses",      "kind": "llm",   "agent": "sense-partitioner",
    "produces": ["sense"],                       // a different field — orthogonal, never conflicts
    "input": "base + layers below" },

  { "id": 60, "name": "examples",    "kind": "llm",   "agent": "example-writer",
    "produces": ["examples"],
    "input": "base + layers below" },

  { "id": 90, "name": "manual",      "kind": "human",
    "produces": ["*"],                           // humans may override anything
    "input": null }
]
```

This file does three jobs at once:
1. **Declares precedence** in plain order (no folklore).
2. **Declares field ownership** — `produces` lists which fields a layer may write. A layer writing
   a field outside its set is a **test failure**. This is what kills the "two layers fight over the
   meaning list" bug (#4) at the schema level.
3. **Documents how to add a layer** — add an entry here + a folder. That's the whole recipe.

### 4.4 Precedence & field ownership (how the reducer resolves a value)

For each output field, the reducer walks layers **high → low** and takes the **first layer that has
an opinion, wholesale**. It never concatenates two layers' values for one field.

| Field | Owned by (high → low) | Notes |
|-------|------------------------|-------|
| `translation` | translation(40) → cleaner(10) → base | curator wins where it spoke |
| `subDefinitions` (reference meanings) | split(45) → translation(40) → subdef(30) → base | split partitions the meaning list; **wholesale** — fixes #4 |
| `altMeanings` (promoted meanings) | split(45) | which meanings become their own production cards (§4.8) |
| `ipa` | cleaner(10) → base | |
| `examples` | examples(60) → base | tagged by meaning; the reducer partitions them onto the primary (`examples`) and each promoted meaning (`altMeanings[].examples`) by `meaningKey` (§4.8) |
| `sense` (primary grouping + gloss); `Translation.senseKey`/`.gloss` (promoted) | senses(50) | synonym grouping + production gloss; orthogonal, no conflicts (§4.8) |
| `drop` / `keep` | highest layer wins | explicit precedence *replaces* the old "resolve contradictions by hand" rule — a higher layer's `keep` legitimately overrides a lower `drop` |
| any field | manual(90) | humans win |

> The drop/keep change is a quiet but important simplification: because precedence is now explicit,
> we no longer need a test that *forbids* a word from being both dropped and kept. The higher layer
> simply wins. The output-side guard ("a dropped word must not ship") stays.

### 4.5 The LLM model: ledger → compiled view → staleness (the centerpiece)

This is what makes the pipeline cheap to re-run and impossible to silently lose. Every LLM layer has
three things:

```
layers/40-translation/
  runs/                      # ★ APPEND-ONLY LEDGER. Every raw LLM answer ever, committed forever.
    2026-06-30-000.json      #   Named by date+batch. Never edited, never deleted.
    2026-06-30-001.json
    2026-07-15-stale.json    #   A later targeted re-run of a few words just adds a file here.
  decisions.json             # ★ COMPILED VIEW. kellyId → the newest answer for that word.
                             #   Deterministic: newest run wins per word. This is what the reducer reads.
  stale.json                 # ★ STALENESS REPORT (generated). Words whose input changed since
                             #   their newest answer — i.e. the exact set that needs re-curation.
```

How it works:

1. **Each answer records the input it was given.** When we batch word *W* for layer *L*, the
   batcher computes `inputHash` = a short hash of *W's data as seen from base + the layers below L*
   (its frozen input — **not** the final shipped list). The hash travels into the batch and back
   into the LLM's answer.
2. **The ledger is append-only.** A new pass (full or targeted) writes a new file under `runs/`.
   Nothing is ever overwritten or deleted, so no LLM result can be lost to a mistake. This is in git.
3. **Compile is deterministic.** A small step folds `runs/*` into `decisions.json` by taking the
   **newest answer per `kellyId`** (by an explicit sequence, not filesystem order). Re-curating a
   word just means its newest answer wins. The resurrection bug (#2) cannot happen because order is
   explicit, not alphabetical.
4. **Staleness is mechanical.** On every build, for each word in `decisions.json`, recompute its
   current `inputHash` (from current base + lower layers). If it differs from the stored one, the
   word is **stale** → listed in `stale.json`. That is the precise answer to *"which words need a
   fresh LLM pass?"*

What this buys, mapped to the original asks:
- *"results kept somewhere"* → `runs/` is committed forever.
- *"don't re-run LLM normally"* → only **new or stale** words are batched.
- *"don't lose results to mistakes"* → append-only ledger + deterministic compile.
- *"know exactly which words need a new pass"* → `stale.json`.

Human layers (`90-manual`) are just committed files — no ledger needed (a person editing a file is
already its own record in git history).

### 4.6 Recipe — re-curate after a change

1. `pnpm seed:build` (or the staleness check) regenerates `stale.json` for each LLM layer.
2. Batch **only** the words in `stale.json` (+ any never-seen words) into `scratch/`.
3. Dispatch the layer's subagent → it writes a new file into that layer's `runs/`.
4. Compile → `decisions.json`. Rebuild. The reproducibility test confirms the result.

No full sweeps. No lost work. The cost scales with *what changed*, not with the whole list.

### 4.7 Recipe — add a new layer

1. Add an entry to `layers.json` (pick a number for its precedence, list the fields it `produces`).
2. Create `layers/<n>-<name>/`.
3. If LLM: add `runs/`, write a one-paragraph agent contract, point a batcher at "base + layers
   below". If human: just drop in committed JSON files.

That's it. Precedence, ownership, and provenance are all declared in one place.

### 4.8 Multi-meaning words (split · gloss · grouping)

A Swedish word can carry several distinct English meanings; each *worth-practicing* meaning is its own
production card while the word stays **one entry / one word-list row**. Three passes build this, all on
the machinery above. The *runtime* side (recognition-per-word, per-meaning scheduling, multi-answer
group cards) lives in code comments — `src/db/{types,seed}.ts`, `src/srs/session-composer.ts`.

**How a word's meanings are stored.** One entry, meanings partitioned into three buckets:
- **primary** — the `translation` field (`meaningKey` 0); carries the word's **recognition**.
- **promoted** — `altMeanings: [{ key, translation, gloss?, senseKey? }]`; each is its own
  **production** card with its own schedule. `key` (≥1) is a stable per-word id — **never renumber**:
  seed-sync matches a learner's progress by `(seedKey, meaningKey)`.
- **reference** — `subDefinitions`: shown, never practiced.

A meaning's `translation` may be comma-joined synonyms of *one* sense (`"route, trail"`) — that's one card.

**The passes:**
- **`45-split`** (`split-curator`) — sorts each word's meanings into primary/promoted/reference.
  Conservative, learner-first ("trainer, not dictionary"; run on **Opus** — a Sonnet run over-promoted
  ~5×). Candidates: words with a meaning list or a semicolon-joined translation. ~7% of A1–B2 split;
  C1–C2 left unsplit.
- **`50-senses`** (`sense-partitioner` + `gloss-curator`) — groups synonyms into senses and writes the
  production **gloss** (the hint shown when one English phrase maps to several Swedish words). Considers
  primaries **and** promoted meanings. A gloss is written iff the phrase has >1 sense; a single-sense
  synonym group gets an **empty** gloss (it just groups).
- **`token-synonyms.json`** (a committed verdict file read by `groupConcepts`) — widens concept detection
  from first-token identity (`normTr`) to curated token overlap, so `panna` "pan, pot" can group with
  `kastrull` "saucepan, pot, pan". `merges` = group; `keepSeparate` = collisions ruled solo.

**subDefinitions dedup — "other English WORDS, not nuances" (2026-07-04).** A refinement of "other
meanings only": a reference sense that only *restates, narrows, or paraphrases* a sense the main (or a
promoted meaning) already teaches with the **same English word** is noise for a learner — "one who knows
*philosophy* in every sense knows *filosofi* in every sense" (`filosofi → philosophy (personal outlook)`,
`svära → swear, take an oath`). It is removed. But a **genuinely distinct sense** that merely reuses the
English word stays (`bank (of a river)`, `artikel → article (grammar)`, `låga → flame (intense love or
passion)`). The line is **sense distance, not word overlap** — a figurative/different-domain sense is
kept; a same-everyday-word sense the learner already has for free is dropped. This is a *semantic*
judgment and so is **not mechanically enforceable** (`article (grammar)` and `philosophy (personal
outlook)` are string-identical in shape) — it was a one-time targeted pass, not a standing guard.
Machinery (reusing §4.5–4.6): `batch-redundant-subdefs.mjs` selects the ~440 owner-40 words with a
head-overlapping sub-def → two Opus LLM passes, **`subdef-deduplicator`** (proposes drop/keep/strip) then
**`subdef-dedup-reviewer`** (independent second opinion catching over-drops *and* under-drops) →
`stamp-redundant-subdefs.mjs` writes layer-40 runs (main re-injected verbatim → mains + promoted cards
provably unchanged). The reviewer flagged 10 disagreements; a human `ADJUDICATION` map in the stamp
resolved them on the flame/philosophy line. Changing sub-defs cosmetically re-stales the examples layer's
input hash → `pnpm seed:reconcile` (no LLM; examples are unaffected).

**Per-sense examples.** An example sentence uses the word in exactly ONE meaning ("ont i en led i
knäet" is the *joint* sense, not *route*), so a production card must show only its own meaning's
examples. The examples layer (60) therefore tags each sentence with a `meaningKey` (0 = primary, k = a
promoted `altMeaning`); the reducer partitions them onto `entry.examples` (primary) and
`altMeanings[k].examples` (promoted). Recognition (per word) and Word Detail show them all; production
filters to the meaning asked. Legacy/single-sense answers stay a bare `string[]` (all meaningKey 0), so
single-sense words are byte-identical. **Coverage rule:** a split word that has *any* example must have
one for *every* main meaning — real ones tagged where they fit, a fresh sentence written for the gaps
(so `led → route` gets a real trail sentence). Scope: only split words that already have ≥1 example; a
split word with none is deferred. **Recipe:** `pnpm seed:batch-example-senses` → the
`example-sense-tagger` agent (writes a tagged run into `60-examples/runs/`) → `pnpm seed:build`;
`pnpm seed:audit-examples` guards the coverage rule on the shipped seed. Same ledger/staleness
discipline as §4.5–4.6.

**Grouping key.** Synonyms are asked as one multi-answer card when they share a key: a primary's is
`Entry.sense.key`, a promoted meaning's is `Translation.senseKey` (both stamped by the reducer from the
sense partition). Distinct senses keep distinct keys (`right` → entitlement vs direction never merge).

**Recipe — change a word's meanings / re-run a pass.** Edit the layer (`45-split` for a split verdict,
`token-synonyms.json` for a token merge), then `pnpm seed:batch-split | batch-gloss` → the agent →
`pnpm seed:build`; `pnpm seed:reconcile` re-stamps concepts whose frozen input shifted but whose output
didn't (avoids a needless LLM re-run). Same ledger/staleness discipline as §4.5–4.6.

**Durable gotchas.**
- **Adding a new meaning/entity at `90-manual` means you own all its downstream enrichments.** A layer
  sees only layers *below* it, so a meaning hand-added at the top is invisible to the gloss/sense pass
  (50) — never glossed or grouped. Put splits in `45-split` (below 50). (led/panna started in `90-manual`
  as proofs and had to be relocated.)
- **Cross-cutting invariants need a final-seed audit, not staleness.** Staleness only fires when a
  *layer's own* input changes; it can't see "this promoted meaning has no gloss." The §5 audits check the
  shipped seed.
- **Alternatives rejected:** splitting a word into two entries (gives per-meaning *level*, but clones
  grammar + fractures the word's identity) and a first-class `Sense` table (real refactor, buys nothing
  here). The additive `altMeanings` model is the cheap, reversible middle — revisit only if per-meaning
  *level* is genuinely needed.

---

## 5. Guards (what each test proves, after the redesign)

- **Reproducible** (keep): the committed `seed-sv.json` is exactly what the reducer produces from
  committed inputs. Catches "fix applied to the output, not saved as a layer."
- **Field ownership** (new, simple): no layer writes a field outside its `produces` set in
  `layers.json`. Catches #4 at the source.
- **One word per layer** (new, simple): a `kellyId` appears at most once per layer's compiled view.
  Replaces the brittle cross-file "contradictory verdict" check.
- **Drop-is-absent** (keep): a word resolved to `drop` does not ship.
- **Keys exist** (keep): every layer record points at a `kellyId` present in `base.json`. The one
  guard that matters if the dump is ever bumped.
- **No staleness on a clean build** (new, optional): after a full build, `stale.json` is empty —
  i.e. every committed LLM answer is based on current input. Turns "did we forget to re-curate?"
  into a green/red check.
- **Gloss coverage** (`pnpm seed:audit-gloss`): over the shipped seed, every ambiguous phrase's senses
  are glossed (0 empty, 0 echo), no single-sense phrase carries a gloss, every promoted+ambiguous meaning
  is covered, and every ≥2-member sense's members share one non-empty grouping key. (§4.8)
- **Token-synonym coverage** (`pnpm seed:detect-token-synonyms`): every token-ambiguous solo promoted
  meaning is ruled in `token-synonyms.json` (merged or kept-separate) and every declared merge forms —
  so the gap can't silently regrow. (§4.8)
- **Per-sense example coverage** (`pnpm seed:audit-examples`, also asserted in the test suite): on the
  shipped seed, every split word that has any example has a sense-specific example for its primary AND
  each promoted meaning — so no production card shows another sense's sentence (or nothing while a
  sibling has one). Split words with no examples yet are out of scope. (§4.8)
- **Reference-list purity** (`pnpm seed:audit-subdefs`, also asserted in the test suite): on the shipped
  seed, no `subDefinitions` item is a **bare** (parenthetical-free) restatement of the main translation
  or a promoted `altMeaning` — enforcing "other possible meanings only." Parenthetical-distinguished
  senses (`article (grammar)` beside primary `article`) are legitimate and exempt. Stops a future
  curator re-run or manual edit from quietly reintroducing a main-in-list. (§4.8) **Note:** this catches
  only *bare* main-restatements; the finer "nuance/paraphrase reusing the main word" dedup (§4.8, the
  `filosofi (personal outlook)` class) is a *semantic* line with no mechanical guard — a curator re-run
  could reintroduce that class, caught only by human review, not this audit.

---

## 6. Migration plan (here → there), seed-neutral where possible

The structural move should **not change the shipped list** — only relocate inputs. Verify with the
reproducibility test at each step.

1. **Freeze a baseline.** Record the current `seed-sv.json` version hash. The migration is done
   when the rebuilt seed matches it (until we deliberately change content in step 6).
2. **Lay out the new folders.** Move existing committed inputs into layer folders by *function*:
   - `decisions/00–09` → `10-cleaner/` · `decisions/pos-*` → `20-pos/` · `decisions/sd-*` →
     `30-subdef/` · `decisions/manual,zz-manual,zz-dedup` → `90-manual/`
   - `translation-decisions.json` → `40-translation/` (split into `runs/` + `decisions.json`)
   - `sense-decisions.json` → `50-senses/` · `examples/` → `60-examples/`
   - `candidates.json` → `base.json`
3. **Recover the gitignored LLM runs into the ledger.** The raw `tr-decisions/*` and
   `sense-decisions/*` currently on disk are imported into the new committed `runs/` folders so the
   ledger starts complete. (Do this *before* anything else touches them — it's the one
   not-in-git asset.)
4. **Write the manifest + the new reducer** (reads `layers.json`, resolves fields wholesale).
   Resolve any precedence ties surfaced by the reproducibility test explicitly.
5. **Delete the dead scratch** (`redundant.json`, `resurfaced.json`, `*-changes.txt`, stray
   `clean-tr.json`, `pilot-*`, `b2-*`, `gap-*`, `mop`, `amb-gaps`, `reconcile`…) once confirmed not
   referenced. They were one-off campaign artifacts.
6. **Confirm seed-neutral and stop.** The rebuilt `seed-sv.json` must match the step-1 baseline
   hash exactly. The refactor makes **no content change** — it only relocates inputs and rewrites
   the machinery. Any deliberate content change (e.g. the meaning-list rule) is separate work, done
   later via the normal targeted re-curation recipe (§4.6, §7).

---

## 7. Out of scope / deferred (NOT decisions for this refactor)

The refactor is purely structural and seed-neutral, so it has **no open product decisions**. Three
things were considered and deliberately pushed out — recorded here so they aren't lost:

1. **Meaning list: INCLUDE vs EXCLUDE the main translation.** A *content* change, not a refactor
   step. The refactor faithfully preserves today's list behaviour. Whenever it's picked later, it's
   a one-line reducer transform *plus* a standard targeted re-curation (§4.6) of the words that lack
   a complete curator list — no bespoke plan needed. **Deferred.**
2. **Stable key (`kellyId` vs a natural `lemma|pos|gender`).** Keep `kellyId`. It only breaks on a
   dump bump, and the "keys exist" guard (§5) turns that into a loud red test, not silent
   corruption — so we'll switch *if and when* a bump actually proves it necessary, no sooner.
   **Deferred to a future dump bump (which may never come).**
3. **Collapsing the legacy cleaner passes (10/20/30) into the curator layer (40).** Two senses of
   "collapse" must not be confused: *re-curation* (re-run one unified LLM pass) is a content change
   and stays **out of scope**. But a **content-neutral snapshot-collapse** is a legitimate, separately
   verified **follow-on**: take each word's *resolved* translation/meaning-list/ipa (`resolveThrough`
   the curator layer), write it as layer-40 input, synthesize "promotion runs" so
   `compile(runs) === decisions.json` still holds, delete 10/20/30, and rebuild. The seed stays
   byte-identical (same `version` hash — proven by the reproducibility guard), and it structurally
   *eliminates* the #4 overlap (one translation/meaning-list layer instead of four). It rides on the
   machinery this refactor builds (the manifest + `resolveThrough` + the ledger), which is why it's a
   follow-on rather than part of the seed-neutral move. **Deferred (agreed), done as its own verified
   step.**

---

## 8. Glossary (plain terms used above)

- **Base** — the immutable candidate wordlist; the starting point. (`base.json`, was `candidates.json`.)
- **Layer** — a set of correction records that overrides specific fields. Ordered by precedence.
- **Reducer** — the script that applies base + layers in order and writes the shipped list.
- **Ledger (`runs/`)** — append-only record of every raw LLM answer ever. Committed; never edited.
- **Compiled view (`decisions.json`)** — newest answer per word, derived from the ledger; what the
  reducer reads.
- **Staleness** — a word whose input changed since its last LLM answer; the exact set to re-curate.
- **Wholesale** — a field is taken entirely from one layer, never merged from two.
</content>
</invoke>

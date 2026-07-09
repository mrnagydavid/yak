# Swedish seed — changelog

The human "why" log for the shipped Swedish wordlist, on top of `git blame`. The source of truth is
`wordlist.json` (hand-edited); `pnpm seed:pack` builds the shipped `seed-sv.json` + `version.json`.
Add a dated entry here whenever you change content. Newest first.

See `SNAPSHOT-PIPELINE-DESIGN.md` for the pipeline; §7 has the editing recipes.

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

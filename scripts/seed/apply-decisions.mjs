// Build the final seed from candidates + optional seed-cleaner decisions.
// Output: data/seed-sv.json (canonical, committed) and public/seed-sv.json (served at runtime).
// Run: node scripts/seed/apply-decisions.mjs
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'

const SEED_VERSION = 'sv-2026-06-01' // en.wiktionary dump date the kaikki extract is from
const DECISIONS_DIR = 'data/intermediate/decisions'
const EXAMPLES_DIR = 'data/intermediate/examples' // curated examples for ambiguous cards (Step 15)
const AMBIGUOUS_OUT = 'data/intermediate/ambiguous.json' // emitted for the example-writer step
const SENSE_DECISIONS_FILE = 'data/intermediate/sense-decisions.json' // merged sense pass (production grouping)
const MULTI_TRANSLATION_OUT = 'data/intermediate/multi-translation.json' // emitted for the sense pass
const TRANSLATION_DECISIONS_FILE = 'data/intermediate/translation-decisions.json' // merged translation-curation pass
const MAX_EXAMPLE_LEN = 160 // flashcard examples stay short — drop any longer (poetry/quote dumps)

// Optional output redirect: when SEED_OUT_DIR is set, every generated file is written under that dir
// (mirroring the repo layout) instead of in place. Inputs are always read from the repo. The
// seed-reproducibility guard (tests/seed-reproducible.test.ts) uses this to re-run apply from the
// committed inputs without clobbering the committed outputs, then diff the result.
const OUT_DIR = process.env.SEED_OUT_DIR
const outPath = (p) => (OUT_DIR ? `${OUT_DIR}/${p}` : p)

const cleanTranslation = (t) => t.replace(/\s+/g, ' ').replace(/[\s:;,]+$/, '').trim()
const cleanIpa = (ipa) => ipa.replace(/^\/+/, '').replace(/\/+$/, '').trim()
// Short per-entry content hash. The runtime seed-sync compares it against the stored hash so only
// the cards that actually changed are rewritten (instead of every matched card). Computed over the
// entry *without* `h`, so it stays stable as long as the content does.
const entryHash = (e) => createHash('sha256').update(JSON.stringify(e)).digest('hex').slice(0, 8)

// Strip a leading article/particle so the native lemma is bare — the renderer re-adds it
// (avoids "an a tour"). POS-aware: only what the English renderer would prepend.
function bareNative(pos, t) {
  if (pos === 'noun') return t.replace(/^(an?|the)\s+/i, '').trim() || t
  if (pos === 'verb') return t.replace(/^to\s+/i, '').trim() || t
  return t
}

const CEFR_RANK = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 }
// Compare primary sense only (drop synonyms/clarifications after the first ,/;/( ), and ignore a
// leading article/"to" so "a million" (num) matches "million" (noun, already bared).
const normTr = (s) =>
  (s ?? '')
    .toLowerCase()
    .split(/[;,(]/)[0]
    .replace(/^(an?|the|to)\s+/, '')
    .trim()
const richness = (e) =>
  (e.subDefinitions?.length ?? 0) + (e.examples?.length ?? 0) + Object.keys(e.inflections ?? {}).length
// Whole-string equality after lowercasing, dropping a leading article/"to", and flattening
// punctuation/whitespace — used to detect a sense gloss that merely restates the full translation.
const flatten = (s) => (s ?? '').toLowerCase().replace(/^(an?|the|to)\s+/, '').replace(/[\s.,;:()]+/g, ' ').trim()
const sameText = (a, b) => flatten(a) === flatten(b)

// Collapse "same word, multiple POS, same meaning" duplicates (e.g. mycket: adv/adj/pron all
// "much, a lot") into one card. Conservative: only when every row shares an identical primary
// translation AND each has a distinct POS. Repeated-POS rows are mis-glossed homonyms (lag =
// law/team, val = whale/election) where a real second sense is hidden — left untouched. Rows with
// differing translations are genuine homonyms (en = one/a) — also left untouched.
function collapseDuplicates(entries) {
  const groups = new Map()
  for (const e of entries) {
    if (groups.has(e.lemma) === false) groups.set(e.lemma, [])
    groups.get(e.lemma).push(e)
  }
  const out = []
  let collapsed = 0
  for (const rows of groups.values()) {
    const sameTr = new Set(rows.map((r) => normTr(r.translation))).size === 1
    const distinctPos = new Set(rows.map((r) => r.pos)).size === rows.length
    if (rows.length === 1 || sameTr === false || distinctPos === false) {
      out.push(...rows)
      continue
    }
    rows.sort((a, b) => CEFR_RANK[a.cefr] - CEFR_RANK[b.cefr] || richness(b) - richness(a))
    const keep = { ...rows[0] }
    // Keep ONLY the survivor's sub-definitions — the merged-away rows are the same word+sense, so
    // unioning their (often un-cleaned) sub-defs just re-injects noise. Examples DO union (more
    // attested sentences is strictly better, and they carry no gloss-quality risk).
    const subDefinitions = (rows[0].subDefinitions ?? []).slice(0, 4)
    // Prefer the survivor's examples (rows[0] is the lowest-CEFR/richest row, and its kellyId is the
    // one carried into the seed — so any curated example is keyed to it). Only fall back to the union
    // of merged-away rows when the survivor has none. Unconditional unioning re-injected a sibling's
    // long Wiktionary example over a curated short one (e.g. miljon num vs noun, tills).
    const examples = (rows[0].examples?.length ? rows[0].examples : [...new Set(rows.flatMap((r) => r.examples ?? []))]).slice(0, 2)
    if (subDefinitions.length) keep.subDefinitions = subDefinitions
    else delete keep.subDefinitions
    if (examples.length) keep.examples = examples
    else delete keep.examples
    out.push(keep)
    collapsed += rows.length - 1
  }
  console.log(`collapsed ${collapsed} duplicate-lemma rows (${entries.length} → ${out.length})`)
  return out
}

// All decision files in this dir are a single overlay layer keyed by kellyId; when two files set the
// same kellyId the LAST one wins. Sort the filenames so that "last" is a stable, documented rule
// (alphabetical — hence the `zz-` prefix on the override files) rather than raw readdir order, which is
// not guaranteed across filesystems. (merge-translations.mjs sorts for the same reason.) The
// decision-integrity test forbids a kellyId carrying contradictory verdicts across files, so this
// ordering only ever breaks ties between same-verdict refinements.
async function loadDecisions() {
  const byId = new Map()
  if (!existsSync(DECISIONS_DIR)) return byId
  for (const file of (await readdir(DECISIONS_DIR)).sort()) {
    if (!file.endsWith('.json')) continue
    for (const d of JSON.parse(await readFile(`${DECISIONS_DIR}/${file}`, 'utf-8'))) byId.set(d.kellyId, d)
  }
  return byId
}

// Curated example sentences for ambiguous cards (Step 15), keyed by kellyId. Absent on the first
// pass (before generation has run) — apply-decisions then just emits the ambiguous list.
async function loadExamples() {
  const byId = new Map()
  if (!existsSync(EXAMPLES_DIR)) return byId
  // Sorted so a later file (e.g. reconcile.json) deterministically overrides an earlier one's examples
  // for the same kellyId, regardless of filesystem readdir order. (Same rule as loadDecisions.)
  for (const file of (await readdir(EXAMPLES_DIR)).sort()) {
    if (!file.endsWith('.json')) continue
    for (const e of JSON.parse(await readFile(`${EXAMPLES_DIR}/${file}`, 'utf-8'))) {
      if (Array.isArray(e.examples)) byId.set(e.kellyId, e.examples)
    }
  }
  return byId
}

// Translation-curation decisions (the main-translation + meaning-list quality pass), keyed by
// kellyId. The merged file holds only `fix` objects — a reviewed-and-fine entry emits nothing — and
// is absent before the pass has run. Each fix may carry: `translation` (the new bare primary, possibly
// two co-equal meanings joined by "; "), `senses` (the COMPLETE meaning list, primary first; [] for a
// monosemous word, which clears any stale sub-definitions), and `uncountable` (English noun → no article).
async function loadTranslationDecisions() {
  const byId = new Map()
  if (!existsSync(TRANSLATION_DECISIONS_FILE)) return byId
  for (const d of JSON.parse(await readFile(TRANSLATION_DECISIONS_FILE, 'utf-8'))) {
    if (d.decision === 'fix') byId.set(d.kellyId, d)
  }
  return byId
}

// Sense partitions for multi-translation concepts (the sense pass), keyed kellyId → {key, gloss}.
// Only members of a sense with ≥2 words are stamped — a singleton sense never groups at runtime, so it
// needs no marker. Absent on the first pass (before the sense pass runs); apply then just emits the
// concept list for batching.
async function loadSenses() {
  const byId = new Map()
  if (!existsSync(SENSE_DECISIONS_FILE)) return byId
  for (const concept of JSON.parse(await readFile(SENSE_DECISIONS_FILE, 'utf-8'))) {
    ;(concept.senses ?? []).forEach((s, i) => {
      // Stamp every member of a multi-translation concept: a ≥2-member sense forms a runtime group, and
      // any sense of a polysemous concept (>1 sense) carries a gloss to disambiguate the production
      // prompt (e.g. "hand (body part)" vs "hand (of a clock)") even when its sense is a singleton.
      const key = `${concept.english}#${i}`
      const gloss = (s.gloss ?? '').trim()
      // A singleton sense's gloss only ever labels a solo production prompt (no group tabs to tell
      // apart), so a gloss equal to the card's own translation is pure repetition — suppressed in main().
      const single = (s.members ?? []).length === 1
      for (const kellyId of s.members ?? []) byId.set(kellyId, { key, gloss, single })
    })
  }
  return byId
}

// kellyId becomes the seed's stable cross-version key (seedKey) so a shipped update can be synced
// onto an existing DB without resetting progress. (SPEC §9 / seed-sync)
const toSeedEntry = (e) => {
  const { kellyId, ...rest } = e
  return { seedKey: kellyId, ...rest }
}

async function main() {
  const candidates = JSON.parse(await readFile('data/intermediate/candidates.json', 'utf-8'))
  const decisions = await loadDecisions()
  const translationDecisions = await loadTranslationDecisions()
  const curatedExamples = await loadExamples()
  const senses = await loadSenses()

  const entries = []
  let dropped = 0
  for (const c of candidates) {
    const d = decisions.get(c.kellyId)
    if (d?.decision === 'drop') {
      dropped++
      continue
    }
    // Only a "fix" supplies a new translation/sub-definitions/IPA; "keep" (and entries with no
    // decision) retain the candidate. Guards against "keep" decisions that carry an empty
    // proposedTranslation, which would otherwise blank the entry out.
    const isFix = d?.decision === 'fix'
    const fixTranslation = isFix ? (d.proposedTranslation ?? '').trim() : ''
    // The translation-curation pass is the dedicated main+list quality pass; where it has an opinion
    // on this entry it wins over the cleaner (and the candidate) for the translation and the list.
    const td = translationDecisions.get(c.kellyId)
    const curatedTranslation = (td?.translation ?? '').trim()
    const translation = bareNative(c.pos, cleanTranslation(curatedTranslation || fixTranslation || c.translation || ''))
    if (!translation) continue // no translation yet (unmatched, pending cleanup) → omit
    // A curation fix rebuilds the complete meaning list (primary first). Enforce the pass's contract
    // here so it holds regardless of agent slips: a list is shown ONLY when there are ≥2 distinct
    // meanings — a 0/1-item curated list collapses to none (the headline alone says it). Without a
    // curation fix, fall back to the cleaner/candidate sub-definitions unchanged.
    let subDefinitions
    if (td && Array.isArray(td.senses)) {
      const list = td.senses.map(cleanTranslation).filter(Boolean)
      subDefinitions = list.length >= 2 ? list : []
    } else {
      const subSource = isFix ? (d.proposedSubDefinitions ?? c.subDefinitions) : c.subDefinitions
      subDefinitions = (subSource ?? []).map(cleanTranslation).filter(Boolean)
    }
    const enUncountable = td?.uncountable === true
    // Swedish mass nouns drop the indefinite article in the renderer ("folk", not "ett folk"). Distinct
    // from enUncountable (English side) — countability doesn't always match across the two languages
    // (English "advice" is uncountable, Swedish "ett råd" is not). Set via a decisions/ fix.
    const svUncountable = d?.svUncountable === true
    // IPA override: the dump's IPA is sometimes wrong (e.g. a long /kː/ before a /t/ cluster). A
    // "fix" may supply proposedIpa to replace it; otherwise the candidate's IPA carries through.
    const ipa = (isFix ? (d.proposedIpa ?? '').trim() : '') || c.ipa
    // Ambiguous cards use curated sense-specific examples (Step 15); all others keep Wiktionary's.
    const examples = (curatedExamples.get(c.kellyId) ?? c.examples ?? [])
      .filter((e) => e.length <= MAX_EXAMPLE_LEN)
      .slice(0, 2)
    entries.push({
      kellyId: c.kellyId, // internal — stripped before the seed is written
      lemma: c.lemma,
      pos: c.pos,
      cefr: c.cefr,
      ...(c.gender ? { gender: c.gender } : {}),
      ...(ipa ? { ipa: cleanIpa(ipa) } : {}),
      ...(Object.keys(c.inflections).length ? { inflections: c.inflections } : {}),
      ...(subDefinitions.length ? { subDefinitions } : {}),
      ...(enUncountable ? { enUncountable: true } : {}),
      ...(svUncountable ? { svUncountable: true } : {}),
      ...(examples.length ? { examples } : {}),
      translation,
    })
  }

  const omitted = candidates.length - entries.length - dropped
  const finalEntries = collapseDuplicates(entries)

  // Ambiguous = a lemma carried by more than one surviving card (e.g. fast conj/adj, val en/ett).
  // Emit them (with kellyId) for the example-writer step; the runtime detects ambiguity live.
  const byLemma = new Map()
  for (const e of finalEntries) {
    if (byLemma.has(e.lemma) === false) byLemma.set(e.lemma, [])
    byLemma.get(e.lemma).push(e)
  }
  const ambiguous = []
  for (const rows of byLemma.values()) {
    if (rows.length < 2) continue
    for (const e of rows)
      ambiguous.push({
        kellyId: e.kellyId,
        lemma: e.lemma,
        pos: e.pos,
        gender: e.gender ?? null,
        cefr: e.cefr,
        translation: e.translation,
        currentExamples: e.examples ?? [],
      })
  }
  if (OUT_DIR) await mkdir(outPath('data/intermediate'), { recursive: true })
  await writeFile(outPath(AMBIGUOUS_OUT), JSON.stringify(ambiguous, null, 2))

  // Flag lemmas pronounced differently across senses (e.g. kort kɔrt "short" vs kʊrt "card"). The
  // per-sense IPA is correct, but browser TTS can't be steered to a sense, so the app suppresses the
  // audio button for these (the IPA text still shows). Stamped on every entry of an affected lemma.
  const ipaByLemma = new Map()
  for (const e of finalEntries) {
    if (!e.ipa) continue
    const set = ipaByLemma.get(e.lemma) ?? new Set()
    set.add(cleanIpa(e.ipa))
    ipaByLemma.set(e.lemma, set)
  }
  let ipaAmbiguousCount = 0
  for (const e of finalEntries) {
    if (e.ipa && (ipaByLemma.get(e.lemma)?.size ?? 0) > 1) {
      e.ipaAmbiguous = true
      ipaAmbiguousCount++
    }
  }

  // Production grouping (plan): a "concept" is one English translation carried by ≥2 Swedish answers
  // (e.g. clearly → tydligt/klart/tydligen/uppenbarligen). Emit the concepts for the sense pass to
  // partition into senses, and stamp the sense markers it produced so a runtime production card can
  // group true synonyms by sense (kellyId → {key, gloss}). Grouped on the primary gloss (normTr), which
  // is how same-meaning is judged elsewhere here.
  const byTranslation = new Map()
  for (const e of finalEntries) {
    const k = normTr(e.translation)
    if (!k) continue
    if (byTranslation.has(k) === false) byTranslation.set(k, [])
    byTranslation.get(k).push(e)
  }
  const multiTranslation = []
  for (const rows of byTranslation.values()) {
    if (rows.length < 2) continue
    multiTranslation.push({
      english: rows[0].translation,
      members: rows.map((e) => ({
        kellyId: e.kellyId,
        lemma: e.lemma,
        pos: e.pos,
        cefr: e.cefr,
        ...(e.subDefinitions?.length ? { subDefinitions: e.subDefinitions } : {}),
        ...(e.examples?.length ? { examples: e.examples } : {}),
      })),
    })
  }
  await writeFile(outPath(MULTI_TRANSLATION_OUT), JSON.stringify(multiTranslation, null, 2))

  let senseCount = 0
  for (const e of finalEntries) {
    const s = senses.get(e.kellyId)
    if (s) {
      // Drop a singleton sense's gloss when it just echoes the card's own translation (= the production
      // prompt): "borgare" prompted "a bourgeois, citizen" with helper "(a bourgeois, citizen)" reads as
      // confusing repetition. Full-string match (not just the primary sense) so a gloss that adds a real
      // nuance — "help, aid (in emergency)" vs translation "help, assist" — is kept. The key is kept so
      // grouping/sense tracking is unaffected; a ≥2-member sense keeps its gloss (it labels the group).
      const gloss = s.single && sameText(s.gloss, e.translation) ? '' : s.gloss
      e.sense = { key: s.key, gloss }
      senseCount++
    }
  }

  // Stamp each entry with a per-entry content hash (`h`) for changed-only seed-sync. `h` is added
  // after hashing so it never feeds into its own hash.
  const seedEntries = finalEntries.map(toSeedEntry).map((e) => ({ ...e, h: entryHash(e) }))
  // Version = dump date + content hash, so any curation change flips the version and the runtime
  // seed-sync picks it up (the dump date alone never changes between curation revisions).
  const contentHash = createHash('sha256').update(JSON.stringify(seedEntries)).digest('hex').slice(0, 8)
  const version = `${SEED_VERSION}-${contentHash}`
  const seed = { version, generatedAt: new Date().toISOString(), count: seedEntries.length, entries: seedEntries }
  const json = JSON.stringify(seed)
  // version.json is a few bytes: the runtime fetches it on every launch and only fetches/parses the
  // 2.2MB seed when the version differs from the DB. Precached alongside the seed (vite globPatterns
  // covers *.json), so the two update atomically.
  const versionJson = JSON.stringify({ version })
  await mkdir(outPath('public'), { recursive: true })
  await writeFile(outPath('data/seed-sv.json'), json)
  await writeFile(outPath('public/seed-sv.json'), json)
  await writeFile(outPath('data/version.json'), versionJson)
  await writeFile(outPath('public/version.json'), versionJson)
  console.log(`seed-sv.json: ${seedEntries.length} entries (dropped ${dropped}, omitted ${omitted} untranslated)`)
  console.log(`ambiguous cards: ${ambiguous.length} → ${AMBIGUOUS_OUT}`)
  console.log(`ipa-ambiguous entries (TTS suppressed): ${ipaAmbiguousCount}`)
  console.log(`multi-translation concepts: ${multiTranslation.length} → ${MULTI_TRANSLATION_OUT}`)
  console.log(`sense-tagged entries: ${senseCount}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

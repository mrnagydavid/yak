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
const MAX_EXAMPLE_LEN = 160 // flashcard examples stay short — drop any longer (poetry/quote dumps)

const cleanTranslation = (t) => t.replace(/\s+/g, ' ').replace(/[\s:;,]+$/, '').trim()
const cleanIpa = (ipa) => ipa.replace(/^\/+/, '').replace(/\/+$/, '').trim()

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
    const subDefinitions = [...new Set(rows.flatMap((r) => r.subDefinitions ?? []))].slice(0, 4)
    const examples = [...new Set(rows.flatMap((r) => r.examples ?? []))].slice(0, 2)
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

async function loadDecisions() {
  const byId = new Map()
  if (!existsSync(DECISIONS_DIR)) return byId
  for (const file of await readdir(DECISIONS_DIR)) {
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
  for (const file of await readdir(EXAMPLES_DIR)) {
    if (!file.endsWith('.json')) continue
    for (const e of JSON.parse(await readFile(`${EXAMPLES_DIR}/${file}`, 'utf-8'))) {
      if (Array.isArray(e.examples)) byId.set(e.kellyId, e.examples)
    }
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
  const curatedExamples = await loadExamples()

  const entries = []
  let dropped = 0
  for (const c of candidates) {
    const d = decisions.get(c.kellyId)
    if (d?.decision === 'drop') {
      dropped++
      continue
    }
    // Only a "fix" supplies a new translation/sub-definitions; "keep" (and entries with no
    // decision) retain the candidate. Guards against "keep" decisions that carry an empty
    // proposedTranslation, which would otherwise blank the entry out.
    const isFix = d?.decision === 'fix'
    const fixTranslation = isFix ? (d.proposedTranslation ?? '').trim() : ''
    const translation = bareNative(c.pos, cleanTranslation(fixTranslation || c.translation || ''))
    if (!translation) continue // no translation yet (unmatched, pending cleanup) → omit
    const subSource = isFix ? (d.proposedSubDefinitions ?? c.subDefinitions) : c.subDefinitions
    const subDefinitions = (subSource ?? []).map(cleanTranslation).filter(Boolean)
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
      ...(c.ipa ? { ipa: cleanIpa(c.ipa) } : {}),
      ...(Object.keys(c.inflections).length ? { inflections: c.inflections } : {}),
      ...(subDefinitions.length ? { subDefinitions } : {}),
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
  await writeFile(AMBIGUOUS_OUT, JSON.stringify(ambiguous, null, 2))

  const seedEntries = finalEntries.map(toSeedEntry)
  // Version = dump date + content hash, so any curation change flips the version and the runtime
  // seed-sync picks it up (the dump date alone never changes between curation revisions).
  const contentHash = createHash('sha256').update(JSON.stringify(seedEntries)).digest('hex').slice(0, 8)
  const version = `${SEED_VERSION}-${contentHash}`
  const seed = { version, generatedAt: new Date().toISOString(), count: seedEntries.length, entries: seedEntries }
  const json = JSON.stringify(seed)
  await mkdir('public', { recursive: true })
  await writeFile('data/seed-sv.json', json)
  await writeFile('public/seed-sv.json', json)
  console.log(`seed-sv.json: ${seedEntries.length} entries (dropped ${dropped}, omitted ${omitted} untranslated)`)
  console.log(`ambiguous cards: ${ambiguous.length} → ${AMBIGUOUS_OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

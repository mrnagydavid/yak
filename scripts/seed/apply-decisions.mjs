// The reducer: build the shipped seed from base + the manifest-ordered correction layers.
// Reads data/seed/sv/{base.json, layers.json, layers/*}. Writes the canonical committed copy under
// data/seed/sv/ and the runtime copy under public/. See SEED-PIPELINE-DESIGN.md.
// Run: node scripts/seed/apply-decisions.mjs   (alias: pnpm seed:apply)
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { assemble, cleanIpa, entryHash, loadManifest, loadSenseStamps, sameText, toSeedEntry } from './lib/layers.mjs'

const SEED_VERSION = 'sv-2026-06-01' // en.wiktionary dump date the kaikki extract is from
const AMBIGUOUS_OUT = 'data/scratch/sv/ambiguous.json' // emitted for the example-writer step (60)
const MULTI_TRANSLATION_OUT = 'data/scratch/sv/multi-translation.json' // emitted for the sense pass (50)

// Optional output redirect: when SEED_OUT_DIR is set, every generated file is written under that dir
// (mirroring the repo layout) instead of in place. Inputs are always read from the repo. The
// seed-reproducibility guard uses this to re-run from committed inputs without clobbering the outputs.
const OUT_DIR = process.env.SEED_OUT_DIR
const outPath = (p) => (OUT_DIR ? `${OUT_DIR}/${p}` : p)

async function main() {
  const manifest = await loadManifest()
  const senseLayer = manifest.find((l) => l.kind === 'senses')
  const senses = senseLayer ? await loadSenseStamps(senseLayer) : new Map()

  const { finalEntries, concepts, ambiguous, dropped, omitted } = await assemble(manifest)

  // Emit the batching inputs for the ambiguous-example (60) and sense (50) passes.
  await mkdir(outPath('data/scratch/sv'), { recursive: true })
  await writeFile(outPath(AMBIGUOUS_OUT), JSON.stringify(ambiguous, null, 2))
  await writeFile(outPath(MULTI_TRANSLATION_OUT), JSON.stringify(concepts, null, 2))

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

  // Stamp what the sense/gloss pass produced onto each production slot: the synonym-grouping KEY and a
  // production GLOSS. The primary carries both on `e.sense` (`{ key, gloss }`); each promoted altMeaning
  // carries its own `senseKey` + `gloss`. The KEY is stamped whenever the slot is part of a partitioned
  // (≥2-producer) concept — even a single-sense one — so its synonyms GROUP into one multi-answer card
  // (e.g. husband → make + man). The GLOSS is BLANKED when its English phrase is single-sense (no
  // ambiguity to resolve) — the fix for §12, where the old rule blanked any singleton *sense*, emptying
  // guidance on multi-sense phrases. The "must not echo the prompt" match is kept as a safety net (an
  // echo adds no signal). Multi-sense phrases keep their guidance; a slot's `key`/`senseKey` is retained
  // even when its gloss blanks, so grouping is unaffected.
  const resolveGloss = (stamp, promptText) =>
    stamp.conceptSenses <= 1 || sameText(stamp.gloss, promptText) ? '' : stamp.gloss
  let senseCount = 0
  for (const e of finalEntries) {
    const primary = senses.get(`${e.kellyId}:0`)
    if (primary) {
      e.sense = { key: primary.key, gloss: resolveGloss(primary, e.translation) }
      senseCount++
    }
    for (const m of e.altMeanings ?? []) {
      const stamp = senses.get(`${e.kellyId}:${m.key}`)
      if (!stamp) continue
      m.senseKey = stamp.key // grouping key — always stamped so same-sense synonyms group (route → led/rutt/sträckning)
      const g = resolveGloss(stamp, m.translation)
      if (g) m.gloss = g // absent when unambiguous (keeps the entry lean); when grouped it shows once on the group card
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
  const versionJson = JSON.stringify({ version })
  await mkdir(outPath('data/seed/sv'), { recursive: true })
  await mkdir(outPath('public'), { recursive: true })
  await writeFile(outPath('data/seed/sv/seed-sv.json'), json)
  await writeFile(outPath('public/seed-sv.json'), json)
  await writeFile(outPath('data/seed/sv/version.json'), versionJson)
  await writeFile(outPath('public/version.json'), versionJson)
  console.log(`seed-sv.json: ${seedEntries.length} entries (dropped ${dropped}, omitted ${omitted} untranslated)`)
  console.log(`version: ${version}`)
  console.log(`ambiguous cards: ${ambiguous.length} → ${AMBIGUOUS_OUT}`)
  console.log(`ipa-ambiguous entries (TTS suppressed): ${ipaAmbiguousCount}`)
  console.log(`multi-translation concepts: ${concepts.length} → ${MULTI_TRANSLATION_OUT}`)
  console.log(`sense-tagged entries: ${senseCount}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

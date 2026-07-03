// Chunk split words (words with promoted altMeanings) into batches for the example-sense-tagger
// subagent (layer 60), which attaches each of the word's example sentences to the meaning it
// illustrates AND writes one fresh sentence for any main meaning that has none — so a production card
// shows an example for its OWN sense (the "route" card no longer shows the "joint" sentence).
//
// Scope (per design): only split words that ALREADY have ≥1 example sentence somewhere. A split word
// with no examples at all is left alone for now. The word is shown as a STABLE, FROZEN input; its
// `inputHash` is the authoritative examples-layer hash (from computeInputHashes, exactly what
// stale.mjs recomputes), and the agent echoes it back so staleness stays mechanical.
//
// Selection: by default only words NOT already fully sense-tagged (every meaning covered) or gone
// stale; SEED_BATCH_ALL=1 forces a full re-tag of every candidate.
// Output: data/scratch/sv/example-sense-batches/<n>.json
// Run: node scripts/seed/batch-example-senses.mjs   (after seed:build)
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { assemble, computeInputHashes, layerDir, loadManifest, SCRATCH_DIR } from './lib/layers.mjs'

const BATCH_DIR = `${SCRATCH_DIR}/example-sense-batches`
const BATCH_SIZE = 40
const DATE = new Date().toISOString().slice(0, 10) // dated so compile's newest-per-word wins
const CEFR_RANK = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 }

// The word's meanings as production slots: primary (meaningKey 0) + each promoted altMeaning.
const meaningsOf = (e) => [
  { meaningKey: 0, translation: e.translation },
  ...(e.altMeanings ?? []).map((m) => ({ meaningKey: m.key, translation: m.translation })),
]
// Every sentence the word currently has, across all its meanings (primary's + promoted's).
const allExamplesOf = (e) => [...(e.examples ?? []), ...(e.altMeanings ?? []).flatMap((m) => m.examples ?? [])]

// A candidate is already handled if its committed decision sense-tags an example for EVERY meaning.
function fullyCovered(decision, meanings) {
  if (!decision || !Array.isArray(decision.examples)) return false
  const tagged = new Set(decision.examples.filter((x) => x && typeof x === 'object').map((x) => x.meaningKey))
  return meanings.every((m) => tagged.has(m.meaningKey))
}

async function main() {
  const manifest = await loadManifest()
  const layer = manifest.find((l) => l.kind === 'examples')
  // Full build → curated examples + the split partition (altMeanings). inputHash comes from the
  // authoritative examples-layer hash map so a fresh run leaves stale.json empty.
  const { finalEntries } = await assemble(manifest)
  const inputHashes = (await computeInputHashes(manifest)).examples

  const dir = layerDir(layer)
  const decisions = new Map(
    existsSync(`${dir}/decisions.json`) ? JSON.parse(await readFile(`${dir}/decisions.json`, 'utf-8')).map((d) => [d.kellyId, d]) : [],
  )
  const staleKeys = new Set(existsSync(`${dir}/stale.json`) ? JSON.parse(await readFile(`${dir}/stale.json`, 'utf-8')).map((s) => s.key) : [])
  const all = process.env.SEED_BATCH_ALL === '1'

  const items = finalEntries
    .filter((e) => (e.altMeanings?.length ?? 0) > 0 && allExamplesOf(e).length > 0)
    .map((e) => ({ e, meanings: meaningsOf(e) }))
    .filter(({ e, meanings }) => all || staleKeys.has(e.kellyId) || !fullyCovered(decisions.get(e.kellyId), meanings))
    .map(({ e, meanings }) => ({
      kellyId: e.kellyId,
      lemma: e.lemma,
      pos: e.pos,
      ...(e.gender ? { gender: e.gender } : {}),
      cefr: e.cefr,
      meanings,
      currentExamples: allExamplesOf(e),
      inputHash: inputHashes.get(e.kellyId), // echo back unchanged in the answer
    }))
    .sort((a, b) => (CEFR_RANK[a.cefr] ?? 9) - (CEFR_RANK[b.cefr] ?? 9) || a.lemma.localeCompare(b.lemma, 'sv'))

  if (items.length === 0) {
    console.log('nothing to batch (every split word is already sense-tagged — SEED_BATCH_ALL=1 forces a full re-tag)')
    return
  }
  if (existsSync(BATCH_DIR)) for (const f of await readdir(BATCH_DIR)) await rm(`${BATCH_DIR}/${f}`)
  await mkdir(BATCH_DIR, { recursive: true })
  let n = 0
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    await writeFile(`${BATCH_DIR}/${DATE}-sense-${String(n).padStart(3, '0')}.json`, JSON.stringify(items.slice(i, i + BATCH_SIZE), null, 2))
    n++
  }
  console.log(`wrote ${n} example-sense batches (${items.length} split words${all ? ', full pass' : ', untagged+stale'}, size ${BATCH_SIZE}) → ${BATCH_DIR}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

// Write A1–B1 cards that still carry a long/complex/archaic Wiktionary example into batches for the
// example-writer subagent, which replaces them with short, level-appropriate Swedish sentences.
// The earlier example passes only covered ambiguous cards and cards with NO example, so single-sense
// beginner words that already had a (bad) Wiktionary example were skipped — this catches them.
// Input:  data/seed/sv/seed-sv.json (the built seed) + the 60-examples layer (already-curated)
// Output: data/scratch/sv/bad-example-batches/<n>.json  (example-writer input shape)
// Run: node scripts/seed/batch-bad-examples.mjs
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'

const SEED = 'data/seed/sv/seed-sv.json'
const CURATED = 'data/seed/sv/layers/60-examples/decisions.json'
const BATCH_DIR = 'data/scratch/sv/bad-example-batches'
const BATCH_SIZE = 150
const LEVELS = new Set(['A1', 'A2', 'B1'])
// "Complex" = too long for a flashcard, or carrying punctuation that signals a multi-clause/quoted
// sentence (a fragment, citation, or song lyric) rather than a clean illustrative example.
const isComplex = (ex) => ex.join(' ').length > 70 || /[;:("]/.test(ex.join(' '))

async function loadCuratedIds() {
  const ids = new Set()
  if (!existsSync(CURATED)) return ids
  for (const e of JSON.parse(await readFile(CURATED, 'utf-8'))) if (Array.isArray(e.examples) && e.examples.length) ids.add(e.kellyId)
  return ids
}

async function main() {
  const seed = JSON.parse(await readFile(SEED, 'utf-8'))
  const curated = await loadCuratedIds()

  const cards = seed.entries
    .filter((e) => LEVELS.has(e.cefr))
    .filter((e) => curated.has(e.seedKey) === false)
    .filter((e) => (e.examples?.length ?? 0) === 0 || isComplex(e.examples))
    .map((e) => ({
      kellyId: e.seedKey,
      lemma: e.lemma,
      pos: e.pos,
      gender: e.gender ?? null,
      cefr: e.cefr,
      translation: e.translation,
      currentExamples: e.examples ?? [],
    }))

  if (existsSync(BATCH_DIR)) for (const f of await readdir(BATCH_DIR)) await rm(`${BATCH_DIR}/${f}`)
  await mkdir(BATCH_DIR, { recursive: true })

  let n = 0
  for (let i = 0; i < cards.length; i += BATCH_SIZE) {
    await writeFile(`${BATCH_DIR}/${String(n).padStart(2, '0')}.json`, JSON.stringify(cards.slice(i, i + BATCH_SIZE), null, 2))
    n++
  }
  console.log(`wrote ${n} batch(es) (${cards.length} A1–B1 cards with weak examples, size ${BATCH_SIZE}) → ${BATCH_DIR}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

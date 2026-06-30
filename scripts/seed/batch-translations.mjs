// Chunk the shipped seed entries into batches for the translation-curator subagent, which verifies/
// improves each entry's main translation and rebuilds its complete meaning list. CEFR-ordered so the
// most-studied words are curated first and the pass stays useful even if paused part-way.
// Output: data/intermediate/tr-batches/<n>.json
// Run: node scripts/seed/batch-translations.mjs   (after seed:apply has written data/seed-sv.json)
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'

const SEED = 'data/seed-sv.json'
const WIK = 'data/intermediate/wik.json'
const BATCH_DIR = 'data/intermediate/tr-batches'
const BATCH_SIZE = 100 // entries per batch (each carries its full Wiktionary sense list for context)
const CEFR_RANK = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 }

// The Wiktionary senses join.mjs would have drawn this entry's translation from: prefer the exact-POS
// (and, for nouns, the gender-matching) objects, falling back to all. Gives the curator the full
// meaning picture — including the senses join dropped past the first gloss. May be empty (phrases and
// unmatched lemmas have no Wiktionary entry); the curator then leans on its own Swedish knowledge.
function wikSenses(wik, lemma, pos, gender) {
  const all = wik[lemma] ?? []
  const exact = all.filter((w) => w.pos === pos)
  const genderMatch = pos === 'noun' && gender ? exact.filter((w) => w.gender === gender) : []
  const preferred = genderMatch.length ? genderMatch : exact
  const wiks = preferred.length ? preferred : all
  return [...new Set(wiks.flatMap((w) => w.glosses ?? []))]
}

async function main() {
  const seed = JSON.parse(await readFile(SEED, 'utf-8'))
  const wik = JSON.parse(await readFile(WIK, 'utf-8'))
  const items = seed.entries
    .map((e) => ({
      kellyId: e.seedKey, // the seed's stable key == the candidate's kellyId the decision is matched on
      lemma: e.lemma,
      pos: e.pos,
      ...(e.gender ? { gender: e.gender } : {}),
      cefr: e.cefr,
      currentTranslation: e.translation,
      ...(e.subDefinitions?.length ? { currentSubDefinitions: e.subDefinitions } : {}),
      ...(e.examples?.length ? { examples: e.examples } : {}),
      wiktionarySenses: wikSenses(wik, e.lemma, e.pos, e.gender),
    }))
    .sort((a, b) => (CEFR_RANK[a.cefr] ?? 9) - (CEFR_RANK[b.cefr] ?? 9) || a.lemma.localeCompare(b.lemma, 'sv'))

  if (existsSync(BATCH_DIR)) for (const f of await readdir(BATCH_DIR)) await rm(`${BATCH_DIR}/${f}`)
  await mkdir(BATCH_DIR, { recursive: true })

  let n = 0
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    await writeFile(`${BATCH_DIR}/${String(n).padStart(3, '0')}.json`, JSON.stringify(batch, null, 2))
    n++
  }
  console.log(`wrote ${n} translation batches (${items.length} entries, size ${BATCH_SIZE}) → ${BATCH_DIR}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

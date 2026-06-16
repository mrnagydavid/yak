// Write flagged entries needing cleanup into batches for the seed-cleaner subagent.
// Scope: missing-translation, definition-like, over-long (the entries that are incomplete or
// definition-y). Pure glued-senses are left as-is (comma/semicolon synonym lists are fine).
// Output: data/intermediate/batches/<n>.json
// Run: node scripts/seed/batch-for-cleanup.mjs
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const BATCH_DIR = 'data/intermediate/batches'
const BATCH_SIZE = 120
const CLEAN_FLAGS = new Set(['missing-translation', 'definition-like', 'over-long', 'abbreviation'])

async function main() {
  const flagged = JSON.parse(await readFile('data/intermediate/flagged.json', 'utf-8'))
  const todo = flagged.filter((c) => c.flags.some((f) => CLEAN_FLAGS.has(f)))

  if (existsSync(BATCH_DIR)) for (const f of await readdir(BATCH_DIR)) await rm(`${BATCH_DIR}/${f}`)
  await mkdir(BATCH_DIR, { recursive: true })

  let n = 0
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE).map((c) => ({
      kellyId: c.kellyId,
      lemma: c.lemma,
      pos: c.pos,
      cefr: c.cefr,
      candidateTranslation: c.translation ?? '',
      subDefinitions: c.subDefinitions ?? [],
      flags: c.flags,
    }))
    await writeFile(`${BATCH_DIR}/${String(n).padStart(2, '0')}.json`, JSON.stringify(batch, null, 2))
    n++
  }
  console.log(`wrote ${n} batches (${todo.length} entries, size ${BATCH_SIZE}) → ${BATCH_DIR}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

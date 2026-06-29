// Chunk multi-translation concepts (≥2 Swedish answers for one English word) into batches for the
// sense-partitioner subagent, which splits each concept into senses + a short native gloss.
// Output: data/intermediate/sense-batches/<n>.json
// Run: node scripts/seed/batch-senses.mjs   (after seed:apply has emitted multi-translation.json)
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'

const SRC = 'data/intermediate/multi-translation.json'
const BATCH_DIR = 'data/intermediate/sense-batches'
const BATCH_SIZE = 60 // concepts per batch (each carries a handful of members)

async function main() {
  const concepts = JSON.parse(await readFile(SRC, 'utf-8'))

  if (existsSync(BATCH_DIR)) for (const f of await readdir(BATCH_DIR)) await rm(`${BATCH_DIR}/${f}`)
  await mkdir(BATCH_DIR, { recursive: true })

  let n = 0
  for (let i = 0; i < concepts.length; i += BATCH_SIZE) {
    const batch = concepts.slice(i, i + BATCH_SIZE)
    await writeFile(`${BATCH_DIR}/${String(n).padStart(2, '0')}.json`, JSON.stringify(batch, null, 2))
    n++
  }
  console.log(`wrote ${n} sense batches (${concepts.length} concepts, size ${BATCH_SIZE}) → ${BATCH_DIR}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

// Write the ambiguous cards (from apply-decisions) into batches for the example-writer subagent,
// which produces one short, level-appropriate, sense-specific Swedish example per card. (Step 15)
// Input:  data/intermediate/ambiguous.json
// Output: data/intermediate/example-batches/<n>.json
// Run: node scripts/seed/batch-examples.mjs
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const IN = 'data/intermediate/ambiguous.json'
const BATCH_DIR = 'data/intermediate/example-batches'
const BATCH_SIZE = 150

async function main() {
  const ambiguous = JSON.parse(await readFile(IN, 'utf-8'))

  if (existsSync(BATCH_DIR)) for (const f of await readdir(BATCH_DIR)) await rm(`${BATCH_DIR}/${f}`)
  await mkdir(BATCH_DIR, { recursive: true })

  let n = 0
  for (let i = 0; i < ambiguous.length; i += BATCH_SIZE) {
    const batch = ambiguous.slice(i, i + BATCH_SIZE)
    await writeFile(`${BATCH_DIR}/${String(n).padStart(2, '0')}.json`, JSON.stringify(batch, null, 2))
    n++
  }
  console.log(`wrote ${n} batch(es) (${ambiguous.length} ambiguous cards, size ${BATCH_SIZE}) → ${BATCH_DIR}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

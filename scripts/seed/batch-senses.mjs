// Chunk multi-translation concepts (≥2 Swedish answers for one English word) into batches for the
// sense-partitioner subagent (layer 50), which splits each concept into senses + a short native gloss.
//
// The concepts are the FROZEN input: the grouping resolved from base + the layers below 50, NOT the
// freshly-built seed. Each concept carries its `inputHash` (echoed back in the answer). By default only
// stale + new concepts are batched (§4.6); SEED_BATCH_ALL=1 forces a full pass.
// Output: data/scratch/sv/sense-batches/<n>.json
// Run: node scripts/seed/batch-senses.mjs   (after seed:apply + seed:stale)
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { assemble, layerDir, loadManifest, SCRATCH_DIR, shortHash } from './lib/layers.mjs'

const BATCH_DIR = `${SCRATCH_DIR}/sense-batches`
const BATCH_SIZE = 60 // concepts per batch (each carries a handful of members)
const DATE = new Date().toISOString().slice(0, 10) // batch/answer files are dated so compile's newest-per-concept wins

async function main() {
  const manifest = await loadManifest()
  const layer = manifest.find((l) => l.kind === 'senses')
  const { concepts } = await assemble(manifest, { upToExclusive: layer.id })

  const dir = layerDir(layer)
  const curated = new Set(existsSync(`${dir}/decisions.json`) ? JSON.parse(await readFile(`${dir}/decisions.json`, 'utf-8')).map((c) => c.english) : [])
  const staleKeys = new Set(existsSync(`${dir}/stale.json`) ? JSON.parse(await readFile(`${dir}/stale.json`, 'utf-8')).map((s) => s.key) : [])
  const all = process.env.SEED_BATCH_ALL === '1'

  const items = concepts
    .filter((c) => all || staleKeys.has(c.english) || curated.has(c.english) === false)
    .map((c) => ({ ...c, inputHash: shortHash(c) }))

  if (items.length === 0) {
    console.log('nothing to batch (no stale or new concepts — run with SEED_BATCH_ALL=1 for a full pass)')
    return
  }
  if (existsSync(BATCH_DIR)) for (const f of await readdir(BATCH_DIR)) await rm(`${BATCH_DIR}/${f}`)
  await mkdir(BATCH_DIR, { recursive: true })
  let n = 0
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    await writeFile(`${BATCH_DIR}/${DATE}-${String(n).padStart(2, '0')}.json`, JSON.stringify(items.slice(i, i + BATCH_SIZE), null, 2))
    n++
  }
  console.log(`wrote ${n} sense batches (${items.length} concepts${all ? ', full pass' : ', stale+new'}, size ${BATCH_SIZE}) → ${BATCH_DIR}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

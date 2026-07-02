// Staleness report: for each LLM layer, recompute every decision's current inputHash (from base +
// the layers below it) and compare against the frozen inputHash the answer was given for. A mismatch
// means the word's input changed underneath its last curation — the exact set that needs a fresh
// pass. Writes data/seed/sv/layers/<n>/stale.json (empty on a clean build). See §4.5 / §4.6.
// Run: node scripts/seed/stale.mjs   (alias: pnpm seed:stale)
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { computeInputHashes, layerDir, loadManifest } from './lib/layers.mjs'

const keyOf = { translation: (e) => e.kellyId, split: (e) => e.kellyId, examples: (e) => e.kellyId, senses: (e) => e.english }
// When SEED_OUT_DIR is set, write the reports under it instead of in place (inputs are still read from
// the repo). The no-staleness guard uses this to recompute fresh without touching committed files.
const OUT_DIR = process.env.SEED_OUT_DIR
const outPath = (p) => (OUT_DIR ? `${OUT_DIR}/${p}` : p)

async function main() {
  const manifest = await loadManifest()
  const hashes = await computeInputHashes(manifest)
  let total = 0
  for (const layer of manifest) {
    const hmap = hashes[layer.kind]
    if (!hmap) continue // only the LLM layers have a staleness report
    const file = `${layerDir(layer)}/decisions.json`
    const decisions = existsSync(file) ? JSON.parse(await readFile(file, 'utf-8')) : []
    const key = keyOf[layer.kind]
    const stale = []
    for (const d of decisions) {
      if (!d.inputHash) continue // no frozen baseline recorded → can't judge (treated as up-to-date)
      const now = hmap.get(key(d)) ?? null // null = the word/concept no longer exists in the input
      if (now !== d.inputHash) stale.push({ key: key(d), lemma: d.lemma ?? d.english, was: d.inputHash, now })
    }
    const dest = outPath(`${layerDir(layer)}/stale.json`)
    if (OUT_DIR) await mkdir(dest.slice(0, dest.lastIndexOf('/')), { recursive: true })
    await writeFile(dest, JSON.stringify(stale, null, 2))
    console.log(`${layer.id}-${layer.name}: ${stale.length} stale / ${decisions.length} decisions`)
    total += stale.length
  }
  console.log(total === 0 ? 'clean — nothing to re-curate' : `total ${total} words/concepts need a fresh pass`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

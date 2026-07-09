// ONE-SHOT migration (run once, then delete or keep as a record). The recovered raw batch runs are the
// pristine LLM answers but (a) predate the inputHash schema and (b) don't include the later human
// recoveries that live only in the committed merged files. This snapshots each LLM layer's *current
// committed decisions* into a NEWEST run file (2026-07-01-migration.json) with a frozen inputHash per
// entry. Because it is the newest run, `pnpm seed:compile` folds it as the winning answer for every
// word — so compile reproduces today's content exactly, now carrying the staleness baseline, while the
// raw import runs remain as append-only history. A future targeted re-curation just drops a newer run
// on top. See SEED-PIPELINE-DESIGN.md §4.5 / §6.3.
import { readFile, writeFile } from 'node:fs/promises'
import { computeInputHashes, layerDir, loadManifest } from '../lib/layers.mjs'

const DATE = '2026-07-01'
const keyOf = { translation: (e) => e.kellyId, examples: (e) => e.kellyId, senses: (e) => e.english }

async function main() {
  const manifest = await loadManifest()
  const hashes = await computeInputHashes(manifest)
  for (const layer of manifest) {
    const hmap = hashes[layer.kind]
    if (!hmap) continue // only the LLM layers have a ledger
    const decisions = JSON.parse(await readFile(`${layerDir(layer)}/decisions.json`, 'utf-8'))
    const key = keyOf[layer.kind]
    const stamped = decisions.map((e) => {
      const inputHash = hmap.get(key(e))
      return inputHash ? { ...e, inputHash } : { ...e }
    })
    await writeFile(`${layerDir(layer)}/runs/${DATE}-migration.json`, JSON.stringify(stamped, null, 2))
    console.log(`${layer.id}-${layer.name}: migration run ${stamped.length} entries (${stamped.filter((e) => e.inputHash).length} with inputHash)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

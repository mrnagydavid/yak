// Targeted staleness reconcile: re-stamp currently-stale LLM decisions whose OUTPUT is unaffected by
// the input change, instead of spending an LLM pass to reproduce identical answers. It never edits an
// answer's content — only refreshes its `inputHash` to the current frozen input (an append-only
// reconcile run in runs/, like the earlier import-reconcile runs). A change that genuinely alters an
// answer must be re-curated for real (a fresh agent run whose newer file wins the compile); this tool
// is only for changes that provably don't.
//
// Used twice so far:
//   • the multi-meaning split (layer 45) moved promoted senses out of `subDefinitions`, shifting the
//     senses/examples frozen hashes without changing their outputs;
//   • the §12 gloss re-grouping expanded `groupConcepts` (adding promoted slots + a leaner member
//     shape), re-staling EVERY sense concept — but the concepts the gloss-curator did NOT re-curate
//     (no promoted slot, no empty/echo defect) keep exactly their prior glosses, so they reconcile.
// Because it only touches decisions still flagged stale AFTER the real re-run has compiled, a genuinely
// re-curated concept (now carrying a matching hash) is never in scope and is never overwritten.
//
// Run: node scripts/seed/reconcile-stale.mjs   (after the real re-run compiled + seed:apply + seed:stale)
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { computeInputHashes, layerDir, loadManifest } from '../lib/layers.mjs'

// Local date, so the reconcile run sorts AFTER same-UTC-day earlier runs and wins the compile fold.
const now = new Date()
const DATE = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const keyOf = { translation: (e) => e.kellyId, split: (e) => e.kellyId, examples: (e) => e.kellyId, senses: (e) => e.english }

async function main() {
  const manifest = await loadManifest()
  const hashes = await computeInputHashes(manifest)
  for (const layer of manifest) {
    const hmap = hashes[layer.kind]
    if (!hmap) continue
    const staleFile = `${layerDir(layer)}/stale.json`
    const stale = existsSync(staleFile) ? JSON.parse(await readFile(staleFile, 'utf-8')) : []
    if (stale.length === 0) continue
    const staleKeys = new Set(stale.map((s) => s.key))
    const key = keyOf[layer.kind]
    const decisions = JSON.parse(await readFile(`${layerDir(layer)}/decisions.json`, 'utf-8'))
    const reconciled = decisions
      .filter((e) => staleKeys.has(key(e)))
      .map((e) => ({ ...e, inputHash: hmap.get(key(e)) }))
    await writeFile(`${layerDir(layer)}/runs/${DATE}-reconcile.json`, JSON.stringify(reconciled, null, 2))
    console.log(`${layer.id}-${layer.name}: reconciled ${reconciled.length} stale decision(s)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

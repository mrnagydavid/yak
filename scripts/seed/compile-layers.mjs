// Compile step: fold each LLM layer's append-only runs/ ledger into its committed decisions.json —
// the compiled view the reducer reads. Deterministic: the NEWEST answer per key wins, where "newest"
// is the lexicographically-last run file (dated, sortable names — never filesystem order). This is
// what makes a targeted re-curation safe: drop a newer run file in and its answer wins; nothing older
// is ever silently resurrected. See SEED-PIPELINE-DESIGN.md §4.5.
// Run: node scripts/seed/compile-layers.mjs   (alias: pnpm seed:compile)
import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { layerDir, loadManifest } from './lib/layers.mjs'

// Per-kind fold rules: how to key a run entry, whether to keep it, and a canonical sort for the
// compiled output (deterministic + diff-friendly — decisions.json order never depends on run history).
const byKellyId = (a, b) => a.kellyId - b.kellyId
const KINDS = {
  translation: { keyOf: (e) => e.kellyId, keep: (e) => e.decision === 'fix', sort: byKellyId },
  examples: { keyOf: (e) => e.kellyId, keep: (e) => Array.isArray(e.examples), sort: byKellyId },
  senses: { keyOf: (e) => e.english, keep: () => true, sort: (a, b) => a.english.localeCompare(b.english, 'sv') },
}

async function compileLayer(layer) {
  const rule = KINDS[layer.kind]
  if (!rule) return null // decisions/human layers have no runs ledger — their files ARE the decisions
  const runsDir = `${layerDir(layer)}/runs`
  const byKey = new Map()
  let runCount = 0
  if (existsSync(runsDir)) {
    for (const f of (await readdir(runsDir)).filter((x) => x.endsWith('.json')).sort()) {
      runCount++
      for (const e of JSON.parse(await readFile(`${runsDir}/${f}`, 'utf-8'))) if (rule.keep(e)) byKey.set(rule.keyOf(e), e)
    }
  }
  const compiled = [...byKey.values()].sort(rule.sort)
  await writeFile(`${layerDir(layer)}/decisions.json`, JSON.stringify(compiled, null, 2))
  console.log(`${layer.id}-${layer.name}: compiled ${compiled.length} decisions from ${runCount} run(s)`)
  return compiled.length
}

async function main() {
  const manifest = await loadManifest()
  for (const layer of manifest) await compileLayer(layer)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

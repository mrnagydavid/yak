// Standing audit for the per-sense example policy (SEED-PIPELINE-DESIGN.md §4.8): a split word (one
// with promoted `altMeanings`) that has ANY example sentence must have one for EVERY main meaning —
// the primary AND each promoted meaning — so no production card is left showing another sense's
// sentence (or nothing while a sibling has one). This is the examples analogue of audit-gloss.
//
// Scope: only split words that already have ≥1 example somewhere. A split word with no examples at all
// is out of scope (deferred) and skipped. In the shipped seed the primary's examples live on
// `entry.examples` and a promoted meaning's on `altMeanings[i].examples`.
//
// Run: node scripts/seed/audit-examples.mjs [seedPath] [--json]   (exits non-zero on any violation)
import { readFile } from 'node:fs/promises'
import { SEED_DIR } from './lib/layers.mjs'

async function main() {
  const seedPath = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? `${SEED_DIR}/seed-sv.json`
  const asJson = process.argv.includes('--json')
  const seed = JSON.parse(await readFile(seedPath, 'utf-8'))

  const violations = []
  let inScope = 0
  let skippedNoExamples = 0
  for (const e of seed.entries) {
    if (!e.altMeanings?.length) continue // not split
    const total = (e.examples?.length ?? 0) + (e.altMeanings ?? []).reduce((n, m) => n + (m.examples?.length ?? 0), 0)
    if (total === 0) {
      skippedNoExamples++
      continue // out of scope: no examples to spread yet
    }
    inScope++
    if (!(e.examples?.length > 0)) violations.push(`${e.lemma} (${e.translation}): primary meaning has no example`)
    for (const m of e.altMeanings) if (!(m.examples?.length > 0)) violations.push(`${e.lemma}: promoted meaning "${m.translation}" (key ${m.key}) has no example`)
  }

  if (asJson) {
    console.log(JSON.stringify({ inScope, skippedNoExamples, count: violations.length, violations }, null, 2))
    process.exit(violations.length ? 1 : 0)
  }
  const ok = violations.length === 0 ? '✓' : '✗'
  console.log(`split words with examples audited: ${inScope} · split words with no examples (deferred, skipped): ${skippedNoExamples}`)
  console.log(`${ok} main meanings missing a sense-specific example: ${violations.length}`)
  for (const v of violations.slice(0, 40)) console.log(`  ✗ ${v}`)
  if (violations.length > 40) console.log(`  … and ${violations.length - 40} more`)
  process.exit(violations.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

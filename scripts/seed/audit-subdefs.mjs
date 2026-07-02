// Standing audit for the "other possible meanings only" policy (SEED-PIPELINE-DESIGN.md §4.8):
// a shipped `subDefinitions` list must never repeat the word's main translation or a promoted
// `altMeaning`. This is the reference-list analogue of audit-gloss / detect-token-synonyms.
//
// It flags only BARE duplicates — a list item with NO parenthetical whose comma/semicolon pieces are
// ALL already main/promoted meanings (so it adds nothing). Parenthetical-distinguished senses are
// legitimate distinct meanings that happen to share a headword (`article (grammar)` next to primary
// `article`; `bank (of a river)` next to `bank`), so a naive "piece-set == main" check would
// false-positive on every one of them — they are intentionally exempt (they carry a disambiguator).
//
// Run: node scripts/seed/audit-subdefs.mjs [seedPath] [--json]   (exits non-zero on any violation)
import { readFile } from 'node:fs/promises'
import { flatten, SEED_DIR } from './lib/layers.mjs'

// A translation's comma/semicolon-separated meaning pieces, each normalized (lowercased, leading
// article/"to" dropped, punctuation/whitespace flattened) for set comparison.
const pieces = (s) => (s ?? '').split(/[;,]/).map(flatten).filter(Boolean)

async function main() {
  const seedPath = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? `${SEED_DIR}/seed-sv.json`
  const asJson = process.argv.includes('--json')
  const seed = JSON.parse(await readFile(seedPath, 'utf-8'))

  const violations = []
  let lists = 0
  let exemptParenthetical = 0
  for (const e of seed.entries) {
    if (!e.subDefinitions?.length) continue
    lists++
    // Every meaning already shown as the headline (primary) or a Translations row (promoted).
    const taken = new Set(pieces(e.translation))
    for (const m of e.altMeanings ?? []) for (const p of pieces(m.translation)) taken.add(p)

    for (const s of e.subDefinitions) {
      if (s.includes('(')) {
        // Parenthetical → a disambiguated distinct sense; exempt. Count the ones that share a head
        // with the main/promoted (the cases the bare check would wrongly catch) for visibility.
        if (pieces(s.split('(')[0]).some((p) => taken.has(p))) exemptParenthetical++
        continue
      }
      const ip = pieces(s)
      if (ip.length && ip.every((p) => taken.has(p)))
        violations.push(`${e.lemma} (${e.translation})${e.altMeanings?.length ? ` +[${e.altMeanings.map((m) => m.translation).join(', ')}]` : ''}: "${s}"`)
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ lists, exemptParenthetical, count: violations.length, violations }, null, 2))
    process.exit(violations.length ? 1 : 0)
  }
  const ok = violations.length === 0 ? '✓' : '✗'
  console.log(`subDefinitions lists audited: ${lists} · parenthetical senses sharing a headword (kept): ${exemptParenthetical}`)
  console.log(`${ok} bare list item repeating the main or a promoted meaning: ${violations.length}`)
  for (const v of violations.slice(0, 40)) console.log(`  ✗ ${v}`)
  if (violations.length > 40) console.log(`  … and ${violations.length - 40} more`)
  process.exit(violations.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

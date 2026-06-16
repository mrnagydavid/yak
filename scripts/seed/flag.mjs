// Heuristic flagging — mark candidates whose translation looks suspect or is missing, so the
// seed-cleaner only spends effort where it's needed (targeted cleanup). (SPEC §9.3)
// Output: data/intermediate/flagged.json (candidates with a non-empty `flags` array)
// Run: node scripts/seed/flag.mjs
import { readFile, writeFile } from 'node:fs/promises'

function flagsFor(c) {
  const flags = []
  const t = (c.translation ?? '').trim()
  if (!t) {
    flags.push('missing-translation')
    return flags // nothing else to judge
  }
  // Abbreviation-expansion artefacts ("el. sen" → "electricity later") and par/bracketed noise.
  if (/\b(el|m\.m|t\.ex|d\.v\.s|bl\.a)\b\.?/i.test(t)) flags.push('abbreviation')
  // Dramatically longer than the lemma (likely a definition, not a translation).
  if (t.length > Math.max(40, c.lemma.length * 5)) flags.push('over-long')
  // Multiple glued senses in one string.
  if (/[;]|,\s+\w+,\s+\w+/.test(t)) flags.push('glued-senses')
  // Looks like a full definition rather than a gloss.
  if (/^(a |an |the )?\b\w+\b\s+(of|that|which|used|denoting)\b/i.test(t)) flags.push('definition-like')
  return flags
}

async function main() {
  const candidates = JSON.parse(await readFile('data/intermediate/candidates.json', 'utf-8'))
  const flagged = []
  const counts = {}
  for (const c of candidates) {
    const flags = flagsFor(c)
    if (flags.length === 0) continue
    flagged.push({ ...c, flags })
    for (const f of flags) counts[f] = (counts[f] ?? 0) + 1
  }
  await writeFile('data/intermediate/flagged.json', JSON.stringify(flagged))
  console.log(`flagged ${flagged.length}/${candidates.length} candidates`)
  console.log('by reason:', counts)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

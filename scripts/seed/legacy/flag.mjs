// Heuristic flagging — mark candidates whose translation looks suspect or is missing, so the
// seed-cleaner only spends effort where it's needed (targeted cleanup). (SPEC §9.3)
// Output: data/scratch/sv/flagged.json (candidates with a non-empty `flags` array)
// Run: node scripts/seed/flag.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises'

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

// Two entries with the same lemma+POS and an identical primary translation are almost always a
// homonym whose distinct senses both collapsed onto Wiktionary's first sense (en val / ett val both
// "whale"). The gender-aware join fixes most; this flag catches whatever remains and guards against
// regressions. Compares the primary sense only (text before the first ,/;/( , minus a leading article).
const collisionKey = (c) =>
  `${c.lemma} ${c.pos} ${(c.translation ?? '').toLowerCase().split(/[;,(]/)[0].replace(/^(an?|the)\s+/, '').trim()}`

function collisionIds(candidates) {
  const groups = new Map()
  for (const c of candidates) {
    if ((c.translation ?? '').trim() === '') continue
    const k = collisionKey(c)
    if (groups.has(k) === false) groups.set(k, [])
    groups.get(k).push(c.kellyId)
  }
  const ids = new Set()
  for (const grp of groups.values()) if (grp.length > 1) for (const id of grp) ids.add(id)
  return ids
}

async function main() {
  const candidates = JSON.parse(await readFile('data/seed/sv/base.json', 'utf-8'))
  const collisions = collisionIds(candidates)
  const flagged = []
  const counts = {}
  for (const c of candidates) {
    const flags = flagsFor(c)
    if (collisions.has(c.kellyId)) flags.push('homonym-collision')
    if (flags.length === 0) continue
    flagged.push({ ...c, flags })
    for (const f of flags) counts[f] = (counts[f] ?? 0) + 1
  }
  await mkdir('data/scratch/sv', { recursive: true })
  await writeFile('data/scratch/sv/flagged.json', JSON.stringify(flagged))
  console.log(`flagged ${flagged.length}/${candidates.length} candidates`)
  console.log('by reason:', counts)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

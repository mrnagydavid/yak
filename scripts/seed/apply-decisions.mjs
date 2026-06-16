// Build the final seed from candidates + optional seed-cleaner decisions.
// Output: data/seed-sv.json (canonical, committed) and public/seed-sv.json (served at runtime).
// Run: node scripts/seed/apply-decisions.mjs
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'

const SEED_VERSION = 'sv-2026-06-01' // en.wiktionary dump date the kaikki extract is from
const DECISIONS_DIR = 'data/intermediate/decisions'

const cleanTranslation = (t) => t.replace(/\s+/g, ' ').replace(/[\s:;,]+$/, '').trim()
const cleanIpa = (ipa) => ipa.replace(/^\/+/, '').replace(/\/+$/, '').trim()

// Strip a leading article/particle so the native lemma is bare — the renderer re-adds it
// (avoids "an a tour"). POS-aware: only what the English renderer would prepend.
function bareNative(pos, t) {
  if (pos === 'noun') return t.replace(/^(an?|the)\s+/i, '').trim() || t
  if (pos === 'verb') return t.replace(/^to\s+/i, '').trim() || t
  return t
}

async function loadDecisions() {
  const byId = new Map()
  if (!existsSync(DECISIONS_DIR)) return byId
  for (const file of await readdir(DECISIONS_DIR)) {
    if (!file.endsWith('.json')) continue
    for (const d of JSON.parse(await readFile(`${DECISIONS_DIR}/${file}`, 'utf-8'))) byId.set(d.kellyId, d)
  }
  return byId
}

async function main() {
  const candidates = JSON.parse(await readFile('data/intermediate/candidates.json', 'utf-8'))
  const decisions = await loadDecisions()

  const entries = []
  let dropped = 0
  for (const c of candidates) {
    const d = decisions.get(c.kellyId)
    if (d?.decision === 'drop') {
      dropped++
      continue
    }
    const translation = bareNative(c.pos, cleanTranslation(d?.proposedTranslation ?? c.translation ?? ''))
    if (!translation) continue // no translation yet (unmatched, pending cleanup) → omit
    const subDefinitions = (d?.proposedSubDefinitions ?? c.subDefinitions ?? []).map(cleanTranslation).filter(Boolean)
    entries.push({
      lemma: c.lemma,
      pos: c.pos,
      cefr: c.cefr,
      ...(c.gender ? { gender: c.gender } : {}),
      ...(c.ipa ? { ipa: cleanIpa(c.ipa) } : {}),
      ...(Object.keys(c.inflections).length ? { inflections: c.inflections } : {}),
      ...(subDefinitions.length ? { subDefinitions } : {}),
      ...(c.examples?.length ? { examples: c.examples.slice(0, 2) } : {}),
      translation,
    })
  }

  const seed = { version: SEED_VERSION, generatedAt: new Date().toISOString(), count: entries.length, entries }
  const json = JSON.stringify(seed)
  await mkdir('public', { recursive: true })
  await writeFile('data/seed-sv.json', json)
  await writeFile('public/seed-sv.json', json)
  console.log(`seed-sv.json: ${entries.length} entries (dropped ${dropped}, omitted ${candidates.length - entries.length - dropped} untranslated)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

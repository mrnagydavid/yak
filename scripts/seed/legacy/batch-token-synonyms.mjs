// Chunk ONLY the token-synonym merge concepts for the gloss-curator (layer 50). This is the targeted
// companion to batch-gloss.mjs for SEED-PIPELINE-DESIGN.md §4.8 (Approach A): where batch-gloss
// re-curates the whole promoted/defective repair set, this emits exactly the concepts introduced or
// changed by data/seed/sv/token-synonyms.json — the 6-ish new merges plus any existing concept a
// merge reconstitutes (e.g. `register` gaining anmäla). Every other concept is left untouched so the
// reconciled §12 glosses are preserved byte-for-byte.
//
// The concept (english + producer set) is the FROZEN input; `inputHash` = shortHash(concept), matching
// the senses layer's staleness hash, so an echoed answer clears staleness. currentGloss / subDefs /
// examples / wik are supplementary CONTEXT (not hashed) — the curator preserves good glosses (register's
// verb/noun split) and judges senses. Output shares batch-gloss's shape + dir so the same gloss-curator
// agent and validate-gloss-runs.mjs apply unchanged.
// Run: node scripts/seed/batch-token-synonyms.mjs   (after authoring token-synonyms.json)
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { assemble, layerDir, loadManifest, loadTokenSynonyms, normTr, SCRATCH_DIR, shortHash } from '../lib/layers.mjs'

const BATCH_DIR = `${SCRATCH_DIR}/gloss-batches`
const WIK = `${SCRATCH_DIR}/wik.json`
const now = new Date()
const DATE = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

function wikSenses(wik, lemma, pos, gender) {
  const all = wik[lemma] ?? []
  const exact = all.filter((w) => w.pos === pos)
  const genderMatch = pos === 'noun' && gender ? exact.filter((w) => w.gender === gender) : []
  const preferred = genderMatch.length ? genderMatch : exact
  const wiks = preferred.length ? preferred : all
  return [...new Set(wiks.flatMap((w) => w.glosses ?? []))]
}

async function main() {
  const manifest = await loadManifest()
  const senseLayer = manifest.find((l) => l.kind === 'senses')
  const splitLayer = manifest.find((l) => l.kind === 'split')
  const { finalEntries, concepts } = await assemble(manifest, { upToExclusive: senseLayer.id })
  const byKelly = new Map(finalEntries.map((e) => [e.kellyId, e]))
  const wik = existsSync(WIK) ? JSON.parse(await readFile(WIK, 'utf-8')) : {}
  if (!existsSync(WIK)) console.warn(`warning: ${WIK} not found — batching without Wiktionary context (run pnpm seed:fetch)`)

  const { merges } = await loadTokenSynonyms()
  const wanted = new Set(merges.map((m) => m.english))
  if (wanted.size === 0) { console.log('no token-synonym merges to batch (token-synonyms.json empty)'); return }

  // Prior sense glosses (primary members) + split-pass candidate glosses (promoted members) — context
  // the curator should keep rather than reinvent, exactly as batch-gloss supplies it.
  const priorDecisions = existsSync(`${layerDir(senseLayer)}/decisions.json`) ? JSON.parse(await readFile(`${layerDir(senseLayer)}/decisions.json`, 'utf-8')) : []
  const priorGloss = new Map()
  for (const c of priorDecisions)
    for (const s of c.senses ?? [])
      for (const m of s.members ?? []) priorGloss.set(typeof m === 'number' ? `${m}:0` : `${m.kellyId}:${m.meaningKey ?? 0}`, (s.gloss ?? '').trim())
  const splitDecisions = existsSync(`${layerDir(splitLayer)}/decisions.json`) ? JSON.parse(await readFile(`${layerDir(splitLayer)}/decisions.json`, 'utf-8')) : []
  const splitGloss = new Map()
  for (const d of splitDecisions) for (const m of d.altMeanings ?? []) if (m.gloss) splitGloss.set(`${d.kellyId}:${normTr(m.translation)}`, m.gloss)

  const phraseOf = (m) => (m.promoted ? byKelly.get(m.kellyId)?.altMeanings?.find((a) => a.key === m.meaningKey)?.translation : byKelly.get(m.kellyId)?.translation) ?? ''
  const items = []
  for (const c of concepts) {
    if (!wanted.has(c.english)) continue
    const producers = c.members.map((m) => {
      const e = byKelly.get(m.kellyId)
      const translation = phraseOf(m)
      const currentGloss = m.promoted ? (splitGloss.get(`${m.kellyId}:${normTr(translation)}`) ?? '') : (priorGloss.get(`${m.kellyId}:0`) ?? '')
      return {
        kellyId: m.kellyId,
        meaningKey: m.meaningKey,
        lemma: m.lemma,
        pos: m.pos,
        cefr: e?.cefr,
        promoted: m.promoted,
        translation,
        currentGloss,
        ...(e?.subDefinitions?.length ? { subDefinitions: e.subDefinitions } : {}),
        ...(!m.promoted && e?.examples?.length ? { examples: e.examples.slice(0, 2) } : {}),
        wiktionarySenses: wikSenses(wik, m.lemma, m.pos, e?.gender),
      }
    })
    items.push({ english: c.english, producers, inputHash: shortHash(c) })
  }
  items.sort((a, b) => a.english.localeCompare(b.english, 'sv'))

  const missing = [...wanted].filter((eng) => !items.some((i) => i.english === eng))
  if (missing.length) console.warn(`warning: ${missing.length} merge(s) did not resolve to a ≥2-member concept: ${missing.join(' · ')}`)

  if (existsSync(BATCH_DIR)) for (const f of await readdir(BATCH_DIR)) await rm(`${BATCH_DIR}/${f}`)
  await mkdir(BATCH_DIR, { recursive: true })
  await writeFile(`${BATCH_DIR}/${DATE}-token-000.json`, JSON.stringify(items, null, 2))
  console.log(`wrote 1 token-synonym batch (${items.length} concepts) → ${BATCH_DIR}/${DATE}-token-000.json`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

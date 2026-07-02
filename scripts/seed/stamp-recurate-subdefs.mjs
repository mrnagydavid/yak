// Finalize the subDefinitions re-curation sweep (companion to batch-recurate-subdefs.mjs). The
// translation-curator writes ONLY the cleaned `senses` (other-meanings-only) to scratch answers; this
// step turns each answer into a complete, self-contained layer-40 run record by re-injecting the
// fields the compile's whole-object-replace would otherwise drop:
//   • `translation` / `uncountable` — copied VERBATIM from the word's current layer-40 decision (or,
//     if it never had one, from the shipped seed). This is what guarantees the sweep cannot change any
//     main translation — the agent's output for those fields is ignored entirely.
//   • `inputHash` — taken from the batch input (the authoritative current frozen input), so staleness
//     never fires spuriously.
// Writes data/seed/sv/layers/40-translation/runs/<DATE>-recurate-<n>.json (append-only; a later dated
// run wins the compile fold). Reports any batch word the agent left unanswered.
//
// Run: node scripts/seed/stamp-recurate-subdefs.mjs   (after the agent has filled tr-recurate-answers/)
import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { bareNative, cleanTranslation, layerDir, loadManifest, SCRATCH_DIR, SEED_DIR } from './lib/layers.mjs'

const BATCH_DIR = `${SCRATCH_DIR}/tr-recurate-batches`
const ANSWER_DIR = `${SCRATCH_DIR}/tr-recurate-answers`
const now = new Date()
const DATE = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

const readJson = async (p, fallback) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf-8')) : fallback)

async function main() {
  const manifest = await loadManifest()
  const trLayer = manifest.find((l) => l.kind === 'translation')
  const trDir = layerDir(trLayer)

  // Current layer-40 decision per word — the authoritative source of translation/uncountable to echo.
  const decisions = await readJson(`${trDir}/decisions.json`, [])
  const byId = new Map(decisions.map((d) => [d.kellyId, d]))

  // Shipped seed — fallback translation/enUncountable for a word that had no layer-40 decision.
  const seed = await readJson(`${SEED_DIR}/seed-sv.json`, { entries: [] })
  const shipped = new Map((seed.entries ?? seed).map((e) => [e.seedKey, e]))

  if (!existsSync(ANSWER_DIR)) {
    console.error(`no answers found at ${ANSWER_DIR} — dispatch the translation-curator first`)
    process.exit(1)
  }

  const answerFiles = (await readdir(ANSWER_DIR)).filter((f) => f.endsWith('.json')).sort()
  let written = 0
  const missing = []
  let n = 0
  for (const f of answerFiles) {
    const answers = await readJson(`${ANSWER_DIR}/${f}`, [])
    const batch = await readJson(`${BATCH_DIR}/${f}`, [])
    const hashByKey = new Map(batch.map((b) => [b.kellyId, b.inputHash]))
    const answeredKeys = new Set()

    const records = []
    for (const a of answers) {
      const kellyId = Number(a.kellyId)
      if (!Array.isArray(a.senses)) {
        console.warn(`  ${f}: kellyId ${kellyId} has no senses array — skipped`)
        continue
      }
      answeredKeys.add(kellyId)
      const dec = byId.get(kellyId)
      const ship = shipped.get(kellyId)
      // Echo translation/uncountable verbatim (invariant: the sweep never changes the main).
      const translation = dec?.translation ?? (ship ? bareNative(ship.pos, cleanTranslation(ship.translation)) : undefined)
      const uncountable = dec?.uncountable === true || ship?.enUncountable === true
      records.push({
        kellyId,
        decision: 'fix',
        reason: a.reason ?? 'subDefinitions re-curation: other meanings only (main excluded)',
        ...(translation ? { translation } : {}),
        senses: a.senses.map((s) => String(s)),
        ...(uncountable ? { uncountable: true } : {}),
        inputHash: hashByKey.get(kellyId) ?? a.inputHash,
      })
    }
    for (const b of batch) if (!answeredKeys.has(b.kellyId)) missing.push(`${b.kellyId} ${b.lemma} (${f})`)

    if (records.length) {
      await writeFile(`${trDir}/runs/${DATE}-recurate-${String(n).padStart(3, '0')}.json`, JSON.stringify(records, null, 2))
      written += records.length
      n++
    }
  }
  console.log(`stamped ${written} re-curated records into ${trDir}/runs/ (${n} run file(s))`)
  if (missing.length) console.warn(`\n${missing.length} batch word(s) UNANSWERED — re-dispatch these:\n  ${missing.slice(0, 40).join('\n  ')}`)
  else console.log('all batch words answered ✓')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

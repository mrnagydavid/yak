// Finalize the redundant-subdef cleanup (companion to batch-redundant-subdefs.mjs + the two LLM
// passes). Reads the REVIEWER's endorsed list (subdef-dedup-review-answers/*.finalSubDefinitions) and
// turns each word into a complete, self-contained layer-40 run record, re-injecting the fields the
// compile's whole-object-replace would otherwise drop:
//   • `translation` / `uncountable` — copied VERBATIM from the word's current layer-40 decision (or,
//     if it never had one, from the shipped seed). This guarantees the cleanup cannot change any main
//     translation — the LLM's output for those fields does not exist and is never consulted.
//   • `inputHash` — taken from the review answer / original batch (the current frozen input), so
//     staleness never fires spuriously.
// Only writes a record for a word whose endorsed list actually DIFFERS from the shipped list (a no-op
// cleanup adds nothing to the ledger). Writes append-only run files
// data/seed/sv/layers/40-translation/runs/<DATE>-dedup-<n>.json (a later dated run wins the compile).
//
// Run: node scripts/seed/stamp-redundant-subdefs.mjs   (after the reviewer has filled review-answers/)
import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { bareNative, cleanTranslation, layerDir, loadManifest, SCRATCH_DIR, SEED_DIR } from '../lib/layers.mjs'

const REVIEW_ANSWER_DIR = `${SCRATCH_DIR}/subdef-dedup-review-answers`
const REVIEW_BATCH_DIR = `${SCRATCH_DIR}/subdef-dedup-review-batches`
const now = new Date()
const DATE = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

const readJson = async (p, fallback) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf-8')) : fallback)
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

// Human adjudication of the 10 cases where the two LLM passes disagreed (Pass 1 dropped, the reviewer
// restored). Decided 2026-07-04 on the "flame/philosophy line": a genuine figurative or different-domain
// sense stays (kept via the reviewer's answer); a sense the everyday English word already carries is
// noise and drops (overridden here to Pass 1's result). The 5 KEEPs (avtryck, juvel, majestät, omlopp,
// rena) need no override — the reviewer already kept them. Only the 5 DROPs are forced here.
const ADJUDICATION = new Map([
  [2320, []], //  filosofi  — "philosophy (personal outlook)": shade of the same word (user's example)
  [4041, []], //  svära     — "swear, take an oath": oath-sense of "swear" (user's example)
  [2581, []], //  kriminell — "criminal (a criminal person)": English "criminal" is already noun + adj
  [1817, []], //  leverera  — "deliver (produce results)": English "deliver" already carries this
  [2096, ['across', 'transferred']], // över — drop "over (more than)": English "over" already = "more than"
])

async function main() {
  const manifest = await loadManifest()
  const trLayer = manifest.find((l) => l.kind === 'translation')
  const trDir = layerDir(trLayer)

  // Current layer-40 decision per word — the authoritative source of translation/uncountable to echo.
  const decisions = await readJson(`${trDir}/decisions.json`, [])
  const byId = new Map(decisions.map((d) => [d.kellyId, d]))

  // Shipped seed — fallback translation/enUncountable + the current list (to skip no-op cleanups).
  const seed = await readJson(`${SEED_DIR}/seed-sv.json`, { entries: [] })
  const shipped = new Map((seed.entries ?? seed).map((e) => [e.seedKey, e]))

  if (!existsSync(REVIEW_ANSWER_DIR)) {
    console.error(`no review answers at ${REVIEW_ANSWER_DIR} — dispatch the subdef-dedup-reviewer first`)
    process.exit(1)
  }

  const files = (await readdir(REVIEW_ANSWER_DIR)).filter((f) => f.endsWith('.json')).sort()
  let written = 0
  let noop = 0
  const missing = []
  let n = 0
  for (const f of files) {
    const answers = await readJson(`${REVIEW_ANSWER_DIR}/${f}`, [])
    const batch = await readJson(`${REVIEW_BATCH_DIR}/${f}`, [])
    const hashByKey = new Map(batch.map((b) => [b.kellyId, b.inputHash]))
    const answeredKeys = new Set()

    const records = []
    for (const a of answers) {
      const kellyId = Number(a.kellyId)
      if (!Array.isArray(a.finalSubDefinitions)) {
        console.warn(`  ${f}: kellyId ${kellyId} has no finalSubDefinitions — skipped`)
        continue
      }
      answeredKeys.add(kellyId)
      const senses = (ADJUDICATION.get(kellyId) ?? a.finalSubDefinitions).map((s) => String(s))
      const ship = shipped.get(kellyId)
      // Skip a cleanup that changes nothing — keeps the ledger free of empty edits.
      if (ship && sameList(senses, ship.subDefinitions ?? [])) {
        noop++
        continue
      }
      const dec = byId.get(kellyId)
      // Echo translation/uncountable verbatim (invariant: this pass never changes the main).
      const translation = dec?.translation ?? (ship ? bareNative(ship.pos, cleanTranslation(ship.translation)) : undefined)
      const uncountable = dec?.uncountable === true || ship?.enUncountable === true
      records.push({
        kellyId,
        decision: 'fix',
        reason: a.reason ? `subDef dedup: ${a.reason}` : 'subDef dedup: removed a sense already covered by the main/promoted meaning',
        ...(translation ? { translation } : {}),
        senses,
        ...(uncountable ? { uncountable: true } : {}),
        inputHash: hashByKey.get(kellyId) ?? a.inputHash,
      })
    }
    for (const b of batch) if (!answeredKeys.has(b.kellyId)) missing.push(`${b.kellyId} ${b.lemma} (${f})`)

    if (records.length) {
      await writeFile(`${trDir}/runs/${DATE}-dedup-${String(n).padStart(3, '0')}.json`, JSON.stringify(records, null, 2))
      written += records.length
      n++
    }
  }
  console.log(`stamped ${written} dedup records into ${trDir}/runs/ (${n} run file(s)); ${noop} no-op word(s) skipped`)
  if (missing.length) console.warn(`\n${missing.length} review word(s) UNANSWERED — re-dispatch these:\n  ${missing.slice(0, 40).join('\n  ')}`)
  else console.log('all review words answered ✓')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

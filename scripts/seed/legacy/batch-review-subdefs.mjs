// Pass 2 setup: turn the subdef-deduplicator's proposals into review batches for the
// subdef-dedup-reviewer (the independent second opinion). Joins each original batch item with its
// pass-1 answer so the reviewer sees main/promoted + the ORIGINAL list + the PROPOSED list side by
// side. See SEED-PIPELINE-DESIGN.md §4.8.
//
// Output: data/scratch/sv/subdef-dedup-review-batches/<same-filename>
// Run: node scripts/seed/batch-review-subdefs.mjs   (after the subdef-deduplicator has filled answers)
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { SCRATCH_DIR } from '../lib/layers.mjs'

const BATCH_DIR = `${SCRATCH_DIR}/subdef-dedup-batches`
const ANSWER_DIR = `${SCRATCH_DIR}/subdef-dedup-answers`
const OUT_DIR = `${SCRATCH_DIR}/subdef-dedup-review-batches`

const readJson = async (p, fallback) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf-8')) : fallback)

async function main() {
  if (!existsSync(ANSWER_DIR)) {
    console.error(`no pass-1 answers at ${ANSWER_DIR} — dispatch the subdef-deduplicator first`)
    process.exit(1)
  }
  if (existsSync(OUT_DIR)) for (const f of await readdir(OUT_DIR)) await rm(`${OUT_DIR}/${f}`)
  await mkdir(OUT_DIR, { recursive: true })

  const files = (await readdir(BATCH_DIR)).filter((f) => f.endsWith('.json')).sort()
  let total = 0
  const missing = []
  for (const f of files) {
    const batch = await readJson(`${BATCH_DIR}/${f}`, [])
    const answers = await readJson(`${ANSWER_DIR}/${f}`, [])
    const byId = new Map(answers.map((a) => [Number(a.kellyId), a]))
    const out = []
    for (const b of batch) {
      const a = byId.get(b.kellyId)
      if (!a || !Array.isArray(a.cleanedSubDefinitions)) {
        missing.push(`${b.kellyId} ${b.lemma} (${f})`)
        continue
      }
      out.push({
        kellyId: b.kellyId,
        lemma: b.lemma,
        pos: b.pos,
        cefr: b.cefr,
        mainTranslation: b.mainTranslation,
        promotedMeanings: b.promotedMeanings ?? [],
        originalSubDefinitions: b.currentSubDefinitions,
        proposedSubDefinitions: a.cleanedSubDefinitions,
        proposedReason: a.reason ?? '',
        inputHash: b.inputHash,
      })
    }
    if (out.length) {
      await writeFile(`${OUT_DIR}/${f}`, JSON.stringify(out, null, 2))
      total += out.length
    }
  }
  console.log(`wrote review batches for ${total} words → ${OUT_DIR}`)
  if (missing.length) console.warn(`\n${missing.length} word(s) had no pass-1 answer — re-dispatch the deduplicator for:\n  ${missing.slice(0, 40).join('\n  ')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

// Validate the gloss-curator's run files against the batches they answer, BEFORE compiling. Catches
// the ways an LLM answer can be malformed: wrong/again concept set, a producer dropped/duplicated/
// invented, a member left as a bare int, a wrong inputHash, or a gloss present on a one-sense concept
// / echoing its phrase. Pure lexical checks — no build needed.
// Run: node scripts/seed/validate-gloss-runs.mjs
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { SCRATCH_DIR, SEED_DIR, sameText } from '../lib/layers.mjs'

const BATCH_DIR = `${SCRATCH_DIR}/gloss-batches`
const RUNS_DIR = `${SEED_DIR}/layers/50-senses/runs`

async function main() {
  const batchFiles = (await readdir(BATCH_DIR)).filter((f) => f.endsWith('.json')).sort()
  const problems = []
  let concepts = 0
  let glossed = 0
  for (const f of batchFiles) {
    const runPath = `${RUNS_DIR}/${f}`
    if (!existsSync(runPath)) {
      problems.push(`${f}: NO run file yet at ${runPath}`)
      continue
    }
    const batch = JSON.parse(await readFile(`${BATCH_DIR}/${f}`, 'utf-8'))
    const run = JSON.parse(await readFile(runPath, 'utf-8'))
    if (!Array.isArray(run)) { problems.push(`${f}: run is not an array`); continue }
    if (run.length !== batch.length) problems.push(`${f}: ${run.length} answers for ${batch.length} concepts`)
    for (let i = 0; i < batch.length; i++) {
      const b = batch[i]
      const r = run[i]
      concepts++
      if (!r) { problems.push(`${f}[${i}] ${b.english}: missing answer`); continue }
      if (r.english !== b.english) problems.push(`${f}[${i}]: english "${r.english}" != "${b.english}" (order/verbatim)`)
      if (r.inputHash !== b.inputHash) problems.push(`${f}[${i}] ${b.english}: inputHash "${r.inputHash}" != "${b.inputHash}"`)
      const senses = r.senses ?? []
      // Membership: the multiset of {kellyId:meaningKey} across senses must equal the producer set.
      const want = new Set(b.producers.map((p) => `${p.kellyId}:${p.meaningKey}`))
      const got = []
      for (const s of senses) {
        for (const m of s.members ?? []) {
          if (typeof m === 'number') problems.push(`${f} ${b.english}: bare-int member ${m} (must be {kellyId, meaningKey})`)
          const k = typeof m === 'number' ? `${m}:0` : `${m.kellyId}:${m.meaningKey}`
          got.push(k)
        }
        const g = (s.gloss ?? '').trim()
        if (senses.length === 1 && g !== '') problems.push(`${f} ${b.english}: one-sense concept carries a gloss "${g}" (should be "")`)
        if (senses.length > 1 && g === '') problems.push(`${f} ${b.english}: multi-sense member has empty gloss`)
        // echo check against each member's phrase
        for (const m of s.members ?? []) {
          const p = b.producers.find((p) => p.kellyId === (typeof m === 'number' ? m : m.kellyId) && p.meaningKey === (typeof m === 'number' ? 0 : m.meaningKey))
          if (g && p && sameText(g, p.translation)) problems.push(`${f} ${b.english}: gloss "${g}" echoes phrase "${p.translation}" ({${p.lemma}})`)
        }
      }
      const gotSet = new Set(got)
      if (got.length !== gotSet.size) problems.push(`${f} ${b.english}: duplicate members ${got.join(',')}`)
      for (const w of want) if (!gotSet.has(w)) problems.push(`${f} ${b.english}: producer ${w} missing from answer`)
      for (const w of gotSet) if (!want.has(w)) problems.push(`${f} ${b.english}: invented member ${w}`)
      if (senses.length > 1) glossed += senses.length
    }
  }
  console.log(`checked ${concepts} concepts across ${batchFiles.length} batch/run pairs; ${glossed} glossed senses in multi-sense concepts`)
  if (problems.length) {
    console.log(`\n${problems.length} PROBLEM(S):`)
    for (const p of problems.slice(0, 60)) console.log('  ✗ ' + p)
    process.exit(1)
  }
  console.log('✓ all run files valid')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

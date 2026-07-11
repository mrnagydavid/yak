// Stage 2 of the gloss sweep: mechanically delete every REDUNDANT gloss — one on a SELF-CLEAR slot,
// whose prompt already disambiguates itself (the article on `a feed` vs `to feed`, the `only` in
// `just, only`). Pure function of the token-collision model (lib/glossModel.mjs), the same one the
// checker uses, so "what gets deleted" == "what the checker calls redundant". Grouping keys
// (sense.key / altMeanings[].senseKey) are KEPT — only `gloss` is removed.
//
// Writes a skim report of the deleted glosses that carried real semantic content (not a POS tag, not an
// echo) to data/scratch/sv/ — those are candidates for a translation-sharpen instead (Stage 3).
//
// Run: node scripts/seed/delete-redundant-glosses.mjs   (then: pnpm seed:pack && pnpm seed:audit-gloss)
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { SCRATCH_DIR, SEED_DIR } from './lib/layers.mjs'
import { buildSlots, classify, isEchoGloss, isPosTagGloss } from './lib/glossModel.mjs'

const WORDLIST = `${SEED_DIR}/wordlist.json`

async function main() {
  const raw = await readFile(WORDLIST, 'utf-8')
  const entries = JSON.parse(raw)

  // Safety: our writer must reproduce the committed file byte-for-byte on a no-op, or a "gloss-only"
  // deletion would silently reformat the whole file. Abort if the round-trip drifts.
  const serialize = (data) => `${JSON.stringify(data, null, 2)}\n`
  if (serialize(entries) !== raw) {
    throw new Error('round-trip is not byte-identical — writer would reformat wordlist.json; aborting')
  }

  const { slots } = classify(buildSlots(entries))
  const redundant = new Set()
  const skim = { rich: [], posTag: [], echo: [] }
  for (const s of slots) {
    if (!(s.selfClear && s.gloss)) continue
    redundant.add(`${s.seedKey}:${s.meaningKey}`)
    const rec = { seedKey: s.seedKey, lemma: s.lemma, meaningKey: s.meaningKey, translation: s.translation, gloss: s.gloss }
    if (isPosTagGloss(s.gloss)) skim.posTag.push(rec)
    else if (isEchoGloss(s.gloss, s.translation)) skim.echo.push(rec)
    else skim.rich.push(rec)
  }

  // Apply: delete `gloss` on every redundant slot, keep the grouping key.
  let deleted = 0
  for (const e of entries) {
    if (redundant.has(`${e.seedKey}:0`) && e.sense?.gloss !== undefined) {
      delete e.sense.gloss
      if (Object.keys(e.sense).length === 0) delete e.sense
      deleted++
    }
    for (const m of e.altMeanings ?? []) {
      if (redundant.has(`${e.seedKey}:${m.key}`) && m.gloss !== undefined) {
        delete m.gloss
        deleted++
      }
    }
  }

  await writeFile(WORDLIST, serialize(entries))
  await mkdir(SCRATCH_DIR, { recursive: true })
  await writeFile(`${SCRATCH_DIR}/deleted-glosses-skim.json`, JSON.stringify(skim, null, 2))

  console.log(`deleted ${deleted} redundant glosses`)
  console.log(`  POS-tag: ${skim.posTag.length} · echo: ${skim.echo.length} · semantically rich (skim these): ${skim.rich.length}`)
  console.log(`skim report: ${SCRATCH_DIR}/deleted-glosses-skim.json`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

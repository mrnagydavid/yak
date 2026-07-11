// Gloss / collision audit for production prompts (SNAPSHOT-PIPELINE-DESIGN.md §6.1).
//
// A "gloss" is the tiny parenthetical hint on a PRODUCTION prompt that says which sense of an ambiguous
// English prompt we want. Under the token-collision model (scripts/seed/lib/glossModel.mjs) a gloss is
// needed ONLY when a slot's prompt is BARE-AMBIGUOUS — every articleized synonym token it shows is also
// produced by a DIFFERENT sense. A SELF-CLEAR slot (has a token unique to its sense — the article on
// `a feed` vs `to feed`, or the `only` in `just, only`) needs none.
//
// Invariants — all HARD (CI-gated, counted in `hardTotal`) except MISSING:
//   redundant — a SELF-CLEAR slot must carry NO gloss (pure noise).
//   clash     — two DISTINCT cards must not render an identical prompt+gloss (indistinguishable).
//   pos-tag   — a bare-ambiguous gloss must not be a mere part-of-speech tag ("(verb)", "noun:").
//   echo      — a bare-ambiguous gloss must not just restate its own translation.
// MISSING (report-only, `softTotal`): a bare-ambiguous slot with NO gloss. This is the intended FLOOR —
//   the default/most-common word for a concept (`och`, `få`), or a self-glossing multi-token translation
//   (`inleda` = "begin, introduce, open"), is left plain on purpose. It cannot reach 0 without
//   over-hinting, so it stays informational, never gated.
//
// Run: node scripts/seed/audit-gloss.mjs [seedPath]   (--json for machine output; exits non-zero when
// any HARD violation remains).
import { readFile } from 'node:fs/promises'
import { SEED_DIR } from './lib/layers.mjs'
import { buildSlots, classify, findCardClashes, isEchoGloss, isPosTagGloss } from './lib/glossModel.mjs'

const tag = (s) => `${s.translation}→{${s.lemma}${s.promoted ? '*' : ''}}`

async function main() {
  const seedPath = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? `${SEED_DIR}/seed-sv.json`
  const asJson = process.argv.includes('--json')
  const seed = JSON.parse(await readFile(seedPath, 'utf-8'))

  const { slots } = classify(buildSlots(seed.entries))

  const redundantGloss = [] // HARD: self-clear slot carrying a gloss (pure noise)
  const missingGloss = [] // SOFT (floor): bare-ambiguous slot with no gloss — left plain on purpose
  const posTagGloss = [] // HARD: bare-ambiguous gloss that only tags part of speech
  const echoGloss = [] // HARD: bare-ambiguous gloss that just restates its own translation
  let selfClear = 0
  let bareAmbiguous = 0

  for (const s of slots) {
    if (s.selfClear) {
      selfClear++
      if (s.gloss) redundantGloss.push(`${tag(s)} "${s.gloss}"`)
      continue
    }
    bareAmbiguous++
    if (!s.gloss) {
      missingGloss.push(tag(s))
      continue
    }
    if (isPosTagGloss(s.gloss)) posTagGloss.push(`${tag(s)} "${s.gloss}"`)
    if (isEchoGloss(s.gloss, s.translation)) echoGloss.push(`${tag(s)} "${s.gloss}"`)
  }

  // HARD: two DISTINCT production cards must never render an identical face (prompt + gloss), or the
  // learner cannot tell them apart. (Cards collapse synonyms by senseKey; see findCardClashes.)
  const clash = findCardClashes(slots).map(
    (c) => `"${c.cards[0].prompt}${c.cards[0].gloss ? ` (${c.cards[0].gloss})` : ''}" ← ${c.cards.map((s) => `${s.lemma}${s.promoted ? '*' : ''}`).join(' / ')}`,
  )

  const hardTotal = redundantGloss.length + clash.length + posTagGloss.length + echoGloss.length
  const softTotal = missingGloss.length
  const report = {
    slots: slots.length,
    selfClear,
    bareAmbiguous,
    redundantGloss: redundantGloss.length,
    clash: clash.length,
    missingGloss: missingGloss.length,
    posTagGloss: posTagGloss.length,
    echoGloss: echoGloss.length,
    hardTotal,
    softTotal,
  }

  if (asJson) {
    console.log(JSON.stringify({ report, redundantGloss, clash, missingGloss, posTagGloss, echoGloss }, null, 2))
    process.exit(hardTotal ? 1 : 0)
  }
  const ok = (n) => (n === 0 ? '✓' : '✗')
  const ex = (a, n = 10) => a.slice(0, n).join(' · ')
  console.log(`slots: ${report.slots} · self-clear: ${selfClear} · bare-ambiguous: ${bareAmbiguous}`)
  console.log(`\nHARD (CI-gated):`)
  console.log(`${ok(report.redundantGloss)} self-clear slot carrying a gloss (redundant): ${report.redundantGloss}`)
  if (redundantGloss.length) console.log(`   ${ex(redundantGloss)}`)
  console.log(`${ok(report.clash)} two cards render an identical prompt+gloss (clash): ${report.clash}`)
  if (clash.length) console.log(`   ${ex(clash)}`)
  console.log(`${ok(report.posTagGloss)} bare-ambiguous gloss = POS tag: ${report.posTagGloss}`)
  if (posTagGloss.length) console.log(`   ${ex(posTagGloss)}`)
  console.log(`${ok(report.echoGloss)} bare-ambiguous gloss echoes translation: ${report.echoGloss}`)
  if (echoGloss.length) console.log(`   ${ex(echoGloss)}`)
  console.log(`\nSOFT (report-only — intended floor, not gated):`)
  console.log(`  bare-ambiguous with no gloss: ${report.missingGloss}${missingGloss.length ? `\n   ${ex(missingGloss)}` : ''}`)
  console.log(hardTotal === 0 ? `\n✓ HARD all clear (missing-gloss floor: ${softTotal})` : `\n✗ ${hardTotal} HARD violation(s)`)
  process.exit(hardTotal ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

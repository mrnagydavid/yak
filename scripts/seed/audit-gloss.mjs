// Gloss-coverage audit for production prompts (SEED-PIPELINE-DESIGN.md §4.8).
//
// A "gloss" is the tiny parenthetical hint on a PRODUCTION prompt that says which sense of an
// ambiguous English phrase we want (e.g. `ask, inquire (request politely) → be`). It is needed only
// when an English phrase has >1 sense across the Swedish words that produce it. This audit measures,
// on the SHIPPED seed, whether those hints are present where needed and genuinely useful.
//
// The authority for "which slots share a phrase and how it splits into senses" is the gloss pass's
// compiled partition (50-senses/decisions.json): concept → senses[] → members, where a member is a
// production slot {kellyId, meaningKey} (primary meaning 0, or a promoted altMeaning). The gloss each
// slot actually SHOWS is read from the built seed (primary → entry.sense.gloss; promoted →
// altMeaning.gloss). Cross-referencing the two is exactly the acceptance gate:
//   • multi-sense concept  → every member must carry a distinguishing, non-echo gloss   (was 110 empty)
//   • any concept          → no member's gloss may echo its phrase                        (was 1 echo)
//   • single-sense concept → every member must be gloss-free (no invented hints)          (regression)
//   • promoted + ambiguous → covered by the partition (glossed, or grouped as a synonym)  (§12 #3)
//
// Run: node scripts/seed/audit-gloss.mjs [seedPath]   (--json for machine output)
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { SEED_DIR, layerDir, loadManifest, normTr, sameText } from './lib/layers.mjs'

// Normalize a partition member to {kellyId, meaningKey}: a bare int is a legacy primary-only answer.
const member = (m) => (typeof m === 'number' ? { kellyId: m, meaningKey: 0 } : { kellyId: m.kellyId, meaningKey: m.meaningKey ?? 0 })

async function main() {
  const seedPath = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? `${SEED_DIR}/seed-sv.json`
  const asJson = process.argv.includes('--json')
  const seed = JSON.parse(await readFile(seedPath, 'utf-8'))

  const manifest = await loadManifest()
  const senseLayer = manifest.find((l) => l.kind === 'senses')
  const decFile = `${layerDir(senseLayer)}/decisions.json`
  const decisions = existsSync(decFile) ? JSON.parse(await readFile(decFile, 'utf-8')) : []

  // The seed keyed by kellyId, plus a lookup for the phrase + shown gloss of any production slot.
  const byKelly = new Map(seed.entries.map((e) => [e.seedKey, e]))
  const slotPhrase = (k, mk) => {
    const e = byKelly.get(k)
    return mk === 0 ? e?.translation : e?.altMeanings?.find((m) => m.key === mk)?.translation
  }
  const slotGloss = (k, mk) => {
    const e = byKelly.get(k)
    return (mk === 0 ? e?.sense?.gloss : e?.altMeanings?.find((m) => m.key === mk)?.gloss) ?? ''
  }
  // The production-GROUPING key a slot actually carries in the seed: a primary meaning on
  // `entry.sense.key`, a promoted altMeaning on its own `senseKey`. This is exactly what the composer's
  // `groupProductionCards` reads to decide which answers are asked TOGETHER as one multi-answer card.
  const slotKey = (k, mk) => {
    const e = byKelly.get(k)
    return (mk === 0 ? e?.sense?.key : e?.altMeanings?.find((m) => m.key === mk)?.senseKey) ?? ''
  }
  const label = (k, mk, promoted) => `${slotPhrase(k, mk)}→{${byKelly.get(k)?.lemma}${promoted ? '*' : ''}}`

  const emptyInMulti = []
  const echoes = []
  const singleSenseWithGloss = []
  const groupBroken = []
  let multiSenseConcepts = 0
  let senseSlots = 0
  let groupSenses = 0
  // Every slot the partition covers (so we can find ambiguous promoted slots it MISSED).
  const covered = new Set()

  for (const c of decisions) {
    const senses = c.senses ?? []
    const multi = senses.length >= 2
    if (multi) multiSenseConcepts++
    for (const s of senses) {
      // Grouping invariant (§12 follow-up): a sense with ≥2 producible members must have EVERY member
      // resolving to one shared, non-empty grouping key — otherwise the composer can't ask them as one
      // multi-answer card. A primary reads `entry.sense.key`, a promoted altMeaning its `senseKey`; both
      // should be `english#senseIndex`. Missing/mismatched here = a promoted meaning the build failed to
      // stamp, so `husband` (make + man) or `route` (led + rutt + sträckning) would split into solo cards.
      const present = (s.members ?? []).map(member).filter(({ kellyId, meaningKey }) => slotPhrase(kellyId, meaningKey) !== undefined)
      if (present.length >= 2) {
        groupSenses++
        const keys = present.map(({ kellyId, meaningKey }) => slotKey(kellyId, meaningKey))
        if (new Set(keys).size !== 1 || keys.some((k) => k === ''))
          groupBroken.push(`${c.english}: ${present.map(({ kellyId, meaningKey }, i) => `${label(kellyId, meaningKey, meaningKey !== 0)}=${keys[i] || '∅'}`).join(' | ')}`)
      }
      for (const raw of s.members ?? []) {
        const { kellyId, meaningKey } = member(raw)
        covered.add(`${kellyId}:${meaningKey}`)
        const promoted = meaningKey !== 0
        const phrase = slotPhrase(kellyId, meaningKey)
        if (phrase === undefined) continue // slot dropped from the seed (rare) — nothing to show
        const gloss = slotGloss(kellyId, meaningKey)
        if (multi) {
          senseSlots++
          if (gloss === '') emptyInMulti.push(label(kellyId, meaningKey, promoted))
          else if (sameText(gloss, phrase)) echoes.push(`${label(kellyId, meaningKey, promoted)} "${gloss}"`)
        } else if (gloss !== '') {
          // Single-sense concept (synonyms): a gloss here is an invented hint — a regression.
          if (sameText(gloss, phrase)) echoes.push(`${label(kellyId, meaningKey, promoted)} "${gloss}"`)
          singleSenseWithGloss.push(`${label(kellyId, meaningKey, promoted)} "${gloss}"`)
        }
      }
    }
  }

  // §12 #3 coverage: a promoted altMeaning whose English phrase is produced by >=2 slots (ambiguous)
  // must be covered — either the gloss pass partitioned it (in `covered`, where the multi/single-sense
  // checks above apply) or it carries a seed gloss (a manual altMeaning above the sense pass, e.g.
  // led's "route, trail", glossed in 90-manual). Uncovered = ambiguous, un-partitioned, AND gloss-less.
  const producersByPhrase = new Map()
  const bump = (t) => { const k = normTr(t); if (k) producersByPhrase.set(k, (producersByPhrase.get(k) ?? 0) + 1) }
  for (const e of seed.entries) { bump(e.translation); for (const m of e.altMeanings ?? []) bump(m.translation) }
  const promotedUncovered = []
  for (const e of seed.entries)
    for (const m of e.altMeanings ?? [])
      if ((producersByPhrase.get(normTr(m.translation)) ?? 0) >= 2 && !covered.has(`${e.seedKey}:${m.key}`) && (m.gloss ?? '') === '')
        promotedUncovered.push(`${m.translation}→{${e.lemma}*}`)

  const report = {
    multiSenseConcepts,
    senseSlots,
    groupSenses,
    emptyInMultiSense: emptyInMulti.length,
    echoes: echoes.length,
    singleSenseWithGloss: singleSenseWithGloss.length,
    promotedAmbiguousUncovered: promotedUncovered.length,
    groupKeyBroken: groupBroken.length,
  }
  if (asJson) {
    console.log(JSON.stringify({ report, emptyInMulti, echoes, singleSenseWithGloss, promotedUncovered, groupBroken }, null, 2))
    return
  }
  const ok = (n) => (n === 0 ? '✓' : '✗')
  console.log(`multi-sense concepts: ${report.multiSenseConcepts} · sense-slots: ${report.senseSlots} · groupable senses (≥2 members): ${report.groupSenses}`)
  console.log(`${ok(report.emptyInMultiSense)} empty gloss in a multi-sense concept: ${report.emptyInMultiSense}  (was 110)`)
  console.log(`${ok(report.echoes)} gloss echoes its phrase: ${report.echoes}  (was 1)`)
  console.log(`${ok(report.singleSenseWithGloss)} single-sense concept carrying a gloss (regression): ${report.singleSenseWithGloss}`)
  console.log(`${ok(report.promotedAmbiguousUncovered)} promoted+ambiguous slot the partition missed: ${report.promotedAmbiguousUncovered}`)
  console.log(`${ok(report.groupKeyBroken)} groupable sense whose members don't share one grouping key: ${report.groupKeyBroken}`)
  const ex = (a, n = 12) => a.slice(0, n).join(' · ')
  if (emptyInMulti.length) console.log(`\n  empty: ${ex(emptyInMulti)}`)
  if (echoes.length) console.log(`  echo: ${ex(echoes)}`)
  if (singleSenseWithGloss.length) console.log(`  single-sense-with-gloss: ${ex(singleSenseWithGloss)}`)
  if (promotedUncovered.length) console.log(`  promoted-uncovered: ${ex(promotedUncovered)}`)
  if (groupBroken.length) console.log(`  group-key-broken: ${ex(groupBroken)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

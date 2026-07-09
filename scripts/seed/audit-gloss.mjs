// Grouping-consistency + gloss-coverage audit for production prompts (SNAPSHOT-PIPELINE-DESIGN.md §6.1).
//
// A "gloss" is the tiny parenthetical hint on a PRODUCTION prompt that says which sense of an ambiguous
// English phrase we want (e.g. `ask, inquire (request politely) → be`). It is needed only when an
// English phrase has >1 sense across the Swedish words that produce it. The synonym-grouping "label"
// (`english#N`) is what makes same-sense producers ask as one multi-answer card.
//
// In the snapshot pipeline the AUTHORITY for both is the entries' OWN labels — not a sense layer. This
// audit therefore:
//   1. detects concepts MECHANICALLY: groupConcepts(entries, merges) — an English phrase produced by
//      ≥2 slots (primary meaning 0, or a promoted altMeaning), token-synonym merges included.
//   2. reads each slot's label + gloss straight from the seed (primary → entry.sense.{key,gloss};
//      promoted → altMeanings[k].{senseKey,gloss}).
//   3. groups a concept's slots by label — those groups are the senses "as authored".
//   4. asserts:
//      • every slot in a ≥2-producer concept has a NON-EMPTY label (a blank = an ungrouped member: a
//        producer newly collided with a group but wasn't grouped),
//      • a SINGLE-label concept carries NO gloss on any slot,
//      • a MULTI-label concept carries a NON-ECHO, non-empty gloss on every slot,
//      • (coverage) every promoted + ambiguous slot has a label — a subset of the blank-label check.
//
// Run: node scripts/seed/audit-gloss.mjs [seedPath]   (--json for machine output; exits non-zero on any
// violation)
import { readFile } from 'node:fs/promises'
import { groupConcepts, loadTokenSynonyms, normTr, SEED_DIR, sameText } from './lib/layers.mjs'

// Human-adjudicated blank-label exemptions, keyed "seedKey:meaningKey". A blank grouping key on a
// ≥2-producer concept normally means an ungrouped member (fix by giving it a label). But some
// collisions are string-identical English for a GENUINELY DISTINCT sense that no mechanical rule can
// separate from "should be grouped" — the same semantic line as the filosofi / `article (grammar)`
// class (SEED-PIPELINE-DESIGN.md §4.8). Those are recorded here as explicit human verdicts so the
// check stays hard (a NEW ungrouped producer fails CI) without forcing a false merge.
//   914:0  styck "piece" — the counting-unit "apiece / per unit" ("10 kronor styck"), string-identical
//          to bit/stycke "piece" ("a bit, portion") but a distinct sense; left solo, not grouped.
const BLANK_LABEL_ALLOWLIST = new Set(['914:0'])
// A label is `english#senseIndex`; its english prefix identifies the (possibly cross-first-token)
// concept the sense pass assigned it to.
const labelEnglish = (lbl) => lbl.replace(/#\d+$/, '')

async function main() {
  const seedPath = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? `${SEED_DIR}/seed-sv.json`
  const asJson = process.argv.includes('--json')
  const seed = JSON.parse(await readFile(seedPath, 'utf-8'))
  const { merges } = await loadTokenSynonyms()

  // seedKey IS the old kellyId (toSeedEntry only renamed it), so groupConcepts works on the seed as-is.
  const view = seed.entries.map((e) => ({
    kellyId: e.seedKey, lemma: e.lemma, pos: e.pos, cefr: e.cefr, translation: e.translation, altMeanings: e.altMeanings,
  }))
  const concepts = groupConcepts(view, merges)

  const byKelly = new Map(seed.entries.map((e) => [e.seedKey, e]))
  const alt = (k, mk) => byKelly.get(k)?.altMeanings?.find((m) => m.key === mk)
  const slotPhrase = (k, mk) => (mk === 0 ? byKelly.get(k)?.translation : alt(k, mk)?.translation)
  const slotLabel = (k, mk) => (mk === 0 ? byKelly.get(k)?.sense?.key : alt(k, mk)?.senseKey) ?? ''
  const slotGloss = (k, mk) => (mk === 0 ? byKelly.get(k)?.sense?.gloss : alt(k, mk)?.gloss) ?? ''
  const label = (k, mk, promoted) => `${slotPhrase(k, mk)}→{${byKelly.get(k)?.lemma}${promoted ? '*' : ''}}`

  const blankLabel = [] // ungrouped member of a ≥2-producer concept (no synonym-grouping key)
  const promotedBlankLabel = [] // subset: the promoted+ambiguous coverage case
  const exemptBlankLabel = [] // blank label, but an allowlisted human verdict (distinct string-identical sense)
  const emptyInMulti = [] // multi-sense concept, member with no gloss
  const echoes = [] // gloss just restates its own phrase (adds no signal)
  const singleSenseWithGloss = [] // single-sense concept carrying an INVENTED hint (regression)
  let multiSenseConcepts = 0
  let singleSenseConcepts = 0

  for (const c of concepts) {
    const members = c.members // every member came from the seed, so each has a phrase
    const labels = members.map((m) => slotLabel(m.kellyId, m.meaningKey))
    const senseCount = new Set(labels.filter(Boolean)).size // distinct non-blank labels = senses "as authored"
    const multi = senseCount >= 2
    if (multi) multiSenseConcepts++
    else singleSenseConcepts++

    for (const m of members) {
      const { kellyId, meaningKey, promoted } = m
      const lbl = slotLabel(kellyId, meaningKey)
      const gloss = slotGloss(kellyId, meaningKey)
      const phrase = slotPhrase(kellyId, meaningKey)
      const tag = label(kellyId, meaningKey, promoted)
      if (!lbl) {
        if (BLANK_LABEL_ALLOWLIST.has(`${kellyId}:${meaningKey}`)) exemptBlankLabel.push(`${c.english}: ${tag}`)
        else {
          blankLabel.push(`${c.english}: ${tag}`)
          if (promoted) promotedBlankLabel.push(tag)
        }
      }
      if (gloss && sameText(gloss, phrase)) echoes.push(`${tag} "${gloss}"`)
      if (multi) {
        if (lbl && !gloss) emptyInMulti.push(tag)
      } else if (gloss && labelEnglish(lbl) === c.english) {
        // Flag an invented hint ONLY when the label's english is THIS phrase — i.e. a true single-sense
        // synonym group that shouldn't carry a gloss. A gloss whose label english is BROADER than the
        // phrase (e.g. `of course, you know, after all#1` on "of course") is a legit fragment of a
        // cross-first-token concept whose sibling sense lives under another token (or dropped upstream),
        // NOT an invented hint — the reducer keeps it, so `groupConcepts` seeing one first-token bucket
        // must not mistake it for single-sense. (See SNAPSHOT-PIPELINE-DESIGN.md §6.1 caveat.)
        singleSenseWithGloss.push(`${tag} "${gloss}"`)
      }
    }
  }

  const buckets = { blankLabel, emptyInMulti, echoes, singleSenseWithGloss }
  const total = Object.values(buckets).reduce((n, a) => n + a.length, 0)
  const report = {
    concepts: concepts.length,
    multiSenseConcepts,
    singleSenseConcepts,
    blankLabel: blankLabel.length,
    promotedBlankLabel: promotedBlankLabel.length,
    exemptBlankLabel: exemptBlankLabel.length,
    emptyInMultiSense: emptyInMulti.length,
    echoes: echoes.length,
    singleSenseWithGloss: singleSenseWithGloss.length,
    total,
  }

  if (asJson) {
    console.log(JSON.stringify({ report, blankLabel, emptyInMulti, echoes, singleSenseWithGloss }, null, 2))
    process.exit(total ? 1 : 0)
  }
  const ok = (n) => (n === 0 ? '✓' : '✗')
  console.log(`concepts (≥2 producers): ${report.concepts} · multi-sense: ${report.multiSenseConcepts} · single-sense: ${report.singleSenseConcepts}`)
  console.log(`${ok(report.blankLabel)} ungrouped member (blank grouping key in a ≥2-producer concept): ${report.blankLabel}  (promoted: ${report.promotedBlankLabel}; allowlisted-exempt: ${report.exemptBlankLabel})`)
  console.log(`${ok(report.emptyInMultiSense)} empty gloss in a multi-sense concept: ${report.emptyInMultiSense}`)
  console.log(`${ok(report.echoes)} gloss echoes its phrase: ${report.echoes}`)
  console.log(`${ok(report.singleSenseWithGloss)} single-sense concept carrying a gloss (regression): ${report.singleSenseWithGloss}`)
  const ex = (a, n = 12) => a.slice(0, n).join(' · ')
  if (blankLabel.length) console.log(`\n  blank-label: ${ex(blankLabel)}`)
  if (emptyInMulti.length) console.log(`  empty: ${ex(emptyInMulti)}`)
  if (echoes.length) console.log(`  echo: ${ex(echoes)}`)
  if (singleSenseWithGloss.length) console.log(`  single-sense-with-gloss: ${ex(singleSenseWithGloss)}`)
  console.log(total === 0 ? '\n✓ grouping + gloss consistent' : `\n✗ ${total} violation(s)`)
  process.exit(total ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

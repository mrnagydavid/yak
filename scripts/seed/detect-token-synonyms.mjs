// Token-level synonym detection for promoted meanings (SEED-PIPELINE-DESIGN.md §4.8, Approach A).
//
// Concept identity in `groupConcepts` is the normalized FIRST token of a translation (`normTr`). So a
// promoted meaning whose synonym lives under a LATER token never lands in the same concept and can't
// group: `panna`'s "pan, pot" (first token "pan") never meets `kastrull` "saucepan, pot, pan" (first
// token "saucepan"), though both share the tokens "pan"/"pot". The learner then gets a solo
// `pan, pot → ?` card that silently wants `panna` over `kastrull`.
//
// This script is the maintained artifact behind that gap: it lists every SOLO promoted meaning (one
// with no grouping key) whose English TOKENS are also produced by another Swedish word, with the
// candidate synonym slots — the input to the gloss-curator merge pass (batch-token-synonyms.mjs) and
// the standing GUARD that the class can't silently regrow. A collision is "resolved" once the
// gloss-curator has ruled on it (its slot is a member of a 50-senses decision concept — grouped if the
// verdict was same-sense, split with a gloss if different-sense); an UNRESOLVED collision is one no
// human has ruled on yet.
//
// Reads the SHIPPED seed (data/seed/sv/seed-sv.json) + token-synonyms.json — no layers. Concept
// detection and the grouping labels both come from the seed's own entries (the snapshot is the
// authority; SNAPSHOT-PIPELINE-DESIGN.md §6).
//
// Run: node scripts/seed/detect-token-synonyms.mjs [seedPath] [--json] [--all]
//   --json  machine-readable output (used by batch-token-synonyms.mjs)
//   --all   list every collision, not only the unresolved ones
import { readFile } from 'node:fs/promises'
import { groupConcepts, loadTokenSynonyms, normTr, SEED_DIR } from './lib/layers.mjs'

// All comma/semicolon-separated tokens of a phrase, each normalized like normTr (drop a parenthetical,
// a leading article/"to", lowercase, trim). normTr keys only on tokens[0]; token overlap keys on any.
export const tokensOf = (s) =>
  (s ?? '')
    .toLowerCase()
    .split(/[;,]/)
    .map((t) => t.replace(/\(.*?\)/g, '').replace(/^\s*(an?|the|to)\s+/, '').trim())
    .filter(Boolean)

async function main() {
  const asJson = process.argv.includes('--json')
  const showAll = process.argv.includes('--all')
  const seedPath = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? `${SEED_DIR}/seed-sv.json`
  const seed = JSON.parse(await readFile(seedPath, 'utf-8'))
  const { merges, keepSeparate } = await loadTokenSynonyms()
  // seedKey IS the old kellyId (toSeedEntry only renamed it), so the seed feeds groupConcepts directly.
  const finalEntries = seed.entries.map((e) => ({ kellyId: e.seedKey, lemma: e.lemma, pos: e.pos, cefr: e.cefr, translation: e.translation, altMeanings: e.altMeanings }))
  const concepts = groupConcepts(finalEntries, merges) // MERGE-AWARE (token-synonyms.json)

  // Every production slot (primary meaningKey 0 + each promoted altMeaning), keyed by "kellyId:mk".
  const slots = []
  const byKelly = new Map(finalEntries.map((e) => [e.kellyId, e]))
  for (const e of finalEntries) {
    slots.push({ kellyId: e.kellyId, meaningKey: 0, lemma: e.lemma, pos: e.pos, cefr: e.cefr, promoted: false, translation: e.translation })
    for (const m of e.altMeanings ?? [])
      slots.push({ kellyId: e.kellyId, meaningKey: m.key, lemma: e.lemma, pos: e.pos, cefr: e.cefr, promoted: true, translation: m.translation })
  }
  const slotId = (s) => `${s.kellyId}:${s.meaningKey}`

  // Which slots `groupConcepts` already places in a ≥2-member concept (grouped, first-token identity),
  // and the concept `english` each grouped slot belongs to.
  const conceptOf = new Map()
  for (const c of concepts) for (const m of c.members) conceptOf.set(`${m.kellyId}:${m.meaningKey}`, c.english)

  // Token → slots index, for finding cross-token overlaps.
  const byToken = new Map()
  for (const s of slots) for (const t of tokensOf(s.translation)) {
    if (!byToken.has(t)) byToken.set(t, [])
    byToken.get(t).push(s)
  }

  // The human verdicts. A merge PULLS the solo promoted slot into a concept (it stops being solo, so it
  // no longer surfaces below); keepSeparate RULES it stays solo. A slot named in a merge that is STILL
  // solo here means the merge failed to form a ≥2-member concept — a real error the guard must catch.
  const mergedIds = new Set()
  for (const g of merges) for (const m of g.members) mergedIds.add(`${m.kellyId}:${m.meaningKey}`)
  const separateIds = new Set(keepSeparate.map((k) => `${k.slot.kellyId}:${k.slot.meaningKey}`))

  // Sanity: every merge should have produced a concept the gloss pass then curated, so its members
  // actually carry a shared key at runtime. The seed's own labels are now the authority: a merge is
  // "curated" when every member slot carries a non-empty grouping key whose english-prefix is the
  // merge's `english`. A blank or foreign-prefixed key means the merge never grouped under its concept
  // (authored but not applied). audit-gloss asserts the members SHARE one key; here we flag the
  // merge-level "never grouped under its english" case.
  const bySeed = new Map(seed.entries.map((e) => [e.seedKey, e]))
  const seedLabel = (kellyId, mk) => {
    const e = bySeed.get(kellyId)
    return (mk === 0 ? e?.sense?.key : e?.altMeanings?.find((m) => m.key === mk)?.senseKey) ?? ''
  }
  const labelPrefix = (l) => l.replace(/#\d+$/, '')
  const uncuratedMerges = merges.filter((g) => g.members.some((m) => labelPrefix(seedLabel(m.kellyId, m.meaningKey)) !== g.english)).map((g) => g.english)

  // A collision: a SOLO promoted slot (not in any concept — first-token OR merge) that shares a token
  // with a slot of ANOTHER word under a DIFFERENT first token (else they'd already group). Merged slots
  // are no longer solo, so genuine groupings drop out here automatically.
  const soloPromoted = slots.filter((s) => s.promoted && !conceptOf.has(slotId(s)))
  const collisions = []
  for (const s of soloPromoted) {
    const first = normTr(s.translation)
    const partners = new Map() // slotId → partner slot (dedupe across shared tokens)
    for (const t of tokensOf(s.translation))
      for (const p of byToken.get(t) ?? []) {
        if (p.kellyId === s.kellyId) continue // same word — not a cross-word synonym
        if (normTr(p.translation) === first) continue // same first token → already groups; not the gap
        if (!partners.has(slotId(p))) partners.set(slotId(p), { ...p, sharedTokens: [] })
        partners.get(slotId(p)).sharedTokens.push(t)
      }
    if (partners.size === 0) continue
    // verdict: 'separate' = ruled solo (fine); 'merge-failed' = named in a merge but still solo (error);
    // 'unruled' = no human verdict yet (the anti-regrowth signal).
    const verdict = separateIds.has(slotId(s)) ? 'separate' : mergedIds.has(slotId(s)) ? 'merge-failed' : 'unruled'
    collisions.push({
      slot: { kellyId: s.kellyId, meaningKey: s.meaningKey, lemma: s.lemma, pos: s.pos, cefr: s.cefr, translation: s.translation },
      verdict,
      partners: [...partners.values()].map((p) => ({
        kellyId: p.kellyId,
        meaningKey: p.meaningKey,
        lemma: p.lemma,
        pos: p.pos,
        cefr: p.cefr,
        promoted: p.promoted,
        translation: p.translation,
        sharedTokens: p.sharedTokens,
        grouped: conceptOf.get(slotId(p)) ?? null,
      })),
    })
  }
  collisions.sort((a, b) => a.slot.lemma.localeCompare(b.slot.lemma, 'sv'))

  const grouped = merges.length // merge concepts formed (their promoted members no longer surface)
  const unresolved = collisions.filter((c) => c.verdict !== 'separate')
  const problems = unresolved.length + uncuratedMerges.length
  if (asJson) {
    console.log(JSON.stringify({ groupedMerges: grouped, soloPromoted: soloPromoted.length, collisions, unresolved: unresolved.map((c) => c.slot), uncuratedMerges }, null, 2))
    process.exit(problems ? 1 : 0)
  }
  console.log(`token-synonym merges applied: ${grouped} · solo promoted meanings: ${soloPromoted.length} · token-ambiguous collisions: ${collisions.length} · unresolved: ${unresolved.length}\n`)
  const mark = { separate: '·', 'merge-failed': '✗', unruled: '✗' }
  for (const c of showAll ? collisions : collisions.filter((x) => x.verdict !== 'separate')) {
    const s = c.slot
    const tag = c.verdict === 'separate' ? '' : c.verdict === 'merge-failed' ? '  ← MERGE FAILED (still solo)' : '  ← UNRULED (add a verdict to token-synonyms.json)'
    console.log(`${mark[c.verdict]} "${s.translation}" → {${s.lemma}${s.meaningKey ? '*' : ''}} [${s.pos} ${s.cefr}]${tag}`)
    for (const p of c.partners)
      console.log(`      ↔ "${p.translation}" → {${p.lemma}${p.promoted ? '*' : ''}} [${p.pos} ${p.cefr}] shares {${p.sharedTokens.join(', ')}}${p.grouped ? ` (in concept "${p.grouped}")` : ''}`)
  }
  const hidden = collisions.length - collisions.filter((x) => x.verdict !== 'separate').length
  if (!showAll && hidden) console.log(`\n(${hidden} collision(s) ruled keep-separate, hidden — pass --all to see them)`)
  if (uncuratedMerges.length) console.log(`\n✗ ${uncuratedMerges.length} merge(s) authored but not yet curated by the gloss pass: ${uncuratedMerges.join(' · ')}`)
  console.log(problems === 0 ? '\n✓ every token-ambiguous solo promoted meaning is ruled (grouped or kept separate)' : `\n✗ ${problems} unresolved — see above`)
  process.exit(problems ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

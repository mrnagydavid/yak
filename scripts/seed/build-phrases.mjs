// Build `pos: "phrase"` proverb/idiom entries into the wordlist snapshot.
//
// Source of truth for the sayings: scripts/seed/phrases/proverbs-sv.json ({ sv, en } pairs).
// Each phrase's CEFR is DERIVED, not authored: it is one level above the hardest constituent
// word that already exists in the wordlist (capped at C2). Rationale — a learner reaches level L
// only by graduating recognition of every word at L and below, so a phrase tagged L+1 surfaces as
// a new card exactly when all its words are already being learnt. (See CLAUDE.md / this turn's plan.)
//
// Idempotent upsert BY LEMMA: re-running after adding more sayings only appends the new ones and
// refreshes translations; existing entries (incl. the hand-authored A1 "survival kit" phrases,
// which are NOT in the source list) are left untouched. Run: `node scripts/seed/build-phrases.mjs`
// then `pnpm seed:pack`.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WORDLIST = fileURLToPath(new URL('../../data/seed/sv/wordlist.json', import.meta.url))
const SOURCE = fileURLToPath(new URL('./phrases/proverbs-sv.json', import.meta.url))

const RANK = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 }
const BY_RANK = Object.fromEntries(Object.entries(RANK).map(([k, v]) => [v, k]))
const nextLevel = (cefr) => BY_RANK[Math.min(RANK[cefr] + 1, 6)]

const apply = process.argv.includes('--write')

const entries = JSON.parse(readFileSync(WORDLIST, 'utf8'))
const sayings = JSON.parse(readFileSync(SOURCE, 'utf8'))

// Surface-form → easiest CEFR index (lemmas + all inflected forms; phrases excluded). Keep the
// LOWEST cefr per form; the hardest-word logic below takes the MAX across a phrase's tokens.
const form2cefr = new Map()
const addForm = (form, cefr) => {
  if (!form || !cefr || !(cefr in RANK)) return
  const f = form.toLowerCase()
  const cur = form2cefr.get(f)
  if (!cur || RANK[cefr] < RANK[cur]) form2cefr.set(f, cefr)
}
for (const e of entries) {
  if (e.pos === 'phrase') continue
  addForm(e.lemma, e.cefr)
  for (const v of Object.values(e.inflections ?? {})) if (typeof v === 'string') addForm(v, e.cefr)
}

const tokenize = (s) => (s.toLowerCase().match(/[a-zA-ZåäöÅÄÖéèüÜ]+/g) ?? [])

function deriveCefr(sv) {
  const hits = tokenize(sv)
    .map((t) => [t, form2cefr.get(t)])
    .filter(([, c]) => c)
  if (hits.length === 0) return { cefr: null, hardest: null, unknown: tokenize(sv) }
  const hardest = hits.reduce((a, b) => (RANK[b[1]] > RANK[a[1]] ? b : a))
  const unknown = tokenize(sv).filter((t) => !form2cefr.has(t))
  return { cefr: nextLevel(hardest[1]), hardest, unknown }
}

const byLemma = new Map(entries.map((e) => [e.lemma, e]))
let nextSeedKey = Math.max(0, ...entries.map((e) => e.seedKey ?? 0)) + 1

const dist = {}
const report = []
let added = 0
let updated = 0
const seen = new Set()

for (const { sv, meaning, wordForWord, cefr: authored } of sayings) {
  if (seen.has(sv)) {
    console.warn(`  duplicate in source, skipped: ${sv}`)
    continue
  }
  seen.add(sv)
  const { cefr: derived, hardest, unknown } = deriveCefr(sv)
  if (!derived) {
    console.warn(`  ⚠ no known words, cannot derive CEFR: ${sv}`)
    continue
  }
  // Editorial override: a saying may pin its own `cefr` (idioms whose difficulty lives in a vivid
  // word we don't teach read too easy from the derived floor alone). Never allow BELOW the derived
  // floor — that would surface the phrase before its known words are learnt.
  let cefr = derived
  if (authored) {
    if (!(authored in RANK)) throw new Error(`bad cefr "${authored}" for: ${sv}`)
    if (RANK[authored] < RANK[derived])
      throw new Error(`authored cefr ${authored} < derived floor ${derived} for: ${sv}`)
    cefr = authored
  }
  const tag = authored ? `${cefr}*` : cefr
  dist[cefr] = (dist[cefr] ?? 0) + 1
  report.push({ cefr, tag, hardest: hardest ? `${hardest[0]}=${hardest[1]}` : '?', unknown, sv })

  const existing = byLemma.get(sv)
  if (existing && existing.pos === 'phrase') {
    existing.cefr = cefr
    existing.translation = meaning
    if (wordForWord) existing.wordForWord = wordForWord
    else delete existing.wordForWord
    updated++
  } else if (existing) {
    console.warn(`  ⚠ lemma collides with a non-phrase entry, skipped: ${sv}`)
  } else {
    entries.push({
      seedKey: nextSeedKey++,
      lemma: sv,
      pos: 'phrase',
      cefr,
      ...(wordForWord ? { wordForWord } : {}),
      translation: meaning,
    })
    added++
  }
}

// Report
report.sort((a, b) => RANK[a.cefr] - RANK[b.cefr])
for (const r of report) {
  const warn = r.unknown.length ? `  [unmatched: ${r.unknown.join(', ')}]` : ''
  console.log(`${r.tag}  (${r.hardest})`.padEnd(24) + r.sv + warn)
}
console.log('(* = editorial CEFR override in source)')
console.log('\nDistribution:', JSON.stringify(dist))
console.log(`Would add ${added}, update ${updated} phrase entries (total sayings in source: ${sayings.length}).`)

if (apply) {
  writeFileSync(WORDLIST, JSON.stringify(entries, null, 2) + '\n')
  console.log(`\nWrote ${WORDLIST}`)
} else {
  console.log('\nDry run. Re-run with --write to update wordlist.json.')
}

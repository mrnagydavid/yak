import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface SeedEntry {
  lemma: string
  pos: string
  cefr: string
  gender?: string
  translation: string
  altMeanings?: { key: number; translation: string }[]
  examples?: string[]
  inflections?: Record<string, string>
  wordForWord?: string
}

const seed = JSON.parse(
  readFileSync(fileURLToPath(new URL('../data/seed/sv/seed-sv.json', import.meta.url)), 'utf-8'),
) as { entries: SeedEntry[] }

const byLemma = new Map<string, SeedEntry[]>()
for (const e of seed.entries) {
  const rows = byLemma.get(e.lemma) ?? []
  rows.push(e)
  byLemma.set(e.lemma, rows)
}

// Primary sense, normalized the same way the build's collision check does.
const primary = (t: string) =>
  t.toLowerCase().split(/[;,(]/)[0].replace(/^(an?|the|to)\s+/, '').trim()

describe('Swedish seed integrity', () => {
  it('keeps gender homonyms as distinct cards (val, plan, lag)', () => {
    for (const lemma of ['val', 'plan', 'lag']) {
      const rows = byLemma.get(lemma) ?? []
      expect(rows.length, lemma).toBeGreaterThan(1)
      const senses = new Set(rows.map((r) => primary(r.translation)))
      expect(senses.size, `${lemma} senses`).toBe(rows.length) // each card a different meaning
    }
  })

  it('has no same-lemma+POS cards sharing an identical primary translation (Step 14 guard)', () => {
    const collisions: string[] = []
    for (const [lemma, rows] of byLemma) {
      const seen = new Map<string, number>()
      for (const r of rows) {
        const key = `${r.pos}|${primary(r.translation)}`
        seen.set(key, (seen.get(key) ?? 0) + 1)
      }
      for (const [key, n] of seen) if (n > 1) collisions.push(`${lemma} [${key}] ×${n}`)
    }
    expect(collisions).toEqual([])
  })

  it('gives every ambiguous card a sense-specific example (Step 15)', () => {
    const missing: string[] = []
    for (const [lemma, rows] of byLemma) {
      if (rows.length < 2) continue
      for (const r of rows) if ((r.examples?.length ?? 0) === 0) missing.push(`${lemma} [${r.pos}]`)
    }
    expect(missing).toEqual([])
  })

  // Multi-meaning split (altMeanings): a promoted meaning must be a real, distinct extra sense — never
  // a duplicate of the primary translation, and never repeated. meaningKeys are the stable 1..N run.
  it('keeps promoted altMeanings distinct from the primary and from each other', () => {
    const norm = (s: string) => s.toLowerCase().trim()
    const primarySenses = (t: string) => new Set(norm(t).split(/[;,]/).map((x) => x.trim()).filter(Boolean))
    const bad: string[] = []
    for (const e of seed.entries) {
      if (!e.altMeanings?.length) continue
      const prim = primarySenses(e.translation)
      const seen = new Set<string>()
      const keys: number[] = []
      for (const m of e.altMeanings) {
        const first = norm(m.translation).split(/[;,]/)[0].trim()
        if (!m.translation.trim()) bad.push(`${e.lemma}: empty altMeaning`)
        if (prim.has(first) || prim.has(norm(m.translation))) bad.push(`${e.lemma}: altMeaning "${m.translation}" echoes primary "${e.translation}"`)
        if (seen.has(first)) bad.push(`${e.lemma}: duplicate altMeaning "${m.translation}"`)
        seen.add(first)
        keys.push(m.key)
      }
      // meaningKeys are the append-only 1..N (primary is 0, never in altMeanings).
      if (keys.some((k) => k < 1) || new Set(keys).size !== keys.length) bad.push(`${e.lemma}: bad meaningKeys ${JSON.stringify(keys)}`)
    }
    expect(bad).toEqual([])
  })

  // Phrase levelling (proverbs/idioms, `pos: phrase`): a phrase must be tagged AT LEAST one CEFR step
  // above the hardest word it contains that we actually teach. The composer surfaces a seed entry as a
  // NEW card when `cefr === learnerLevel + 1`, and a learner reaches level L only by graduating every
  // word at L and below — so this "one above the hardest word" floor is exactly what guarantees a phrase
  // appears only once its known words are being learnt. Editorial overrides may raise a phrase higher
  // (idioms whose difficulty lives in a word we don't teach), but never below this floor.
  // Mirror of scripts/seed/build-phrases.mjs. Untaught words in a phrase are ignored (as the rule says).
  it('tags every phrase at least one level above its hardest taught word', () => {
    const RANK: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 }
    const nextRank = (r: number) => Math.min(r + 1, 6)
    const tokenize = (s: string) => s.toLowerCase().match(/[a-zA-ZåäöÅÄÖéèüÜ]+/g) ?? []

    // Surface-form → easiest CEFR rank (lemmas + inflected forms, phrases excluded).
    const form2rank = new Map<string, number>()
    const add = (form: string | undefined, cefr: string) => {
      if (!form || !(cefr in RANK)) return
      const f = form.toLowerCase()
      const r = RANK[cefr]
      if (!form2rank.has(f) || r < form2rank.get(f)!) form2rank.set(f, r)
    }
    for (const e of seed.entries) {
      if (e.pos === 'phrase') continue
      add(e.lemma, e.cefr)
      for (const v of Object.values(e.inflections ?? {})) add(v, e.cefr)
    }

    const violations: string[] = []
    for (const e of seed.entries) {
      if (e.pos !== 'phrase') continue
      // A1 phrases are the deliberately front-loaded "survival kit" (greetings/functional lines shown to
      // beginners BEFORE they know the words) — exempt by design. The floor governs the higher-level
      // proverbs/idioms (B1+), which should appear only once their words are being learnt.
      if (e.cefr === 'A1') continue
      const known = tokenize(e.lemma).map((t) => form2rank.get(t)).filter((r): r is number => r != null)
      if (known.length === 0) continue // no taught word to floor against
      const floor = nextRank(Math.max(...known))
      if (RANK[e.cefr] < floor) {
        violations.push(`${e.lemma} tagged ${e.cefr} but floor is rank ${floor}`)
      }
    }
    expect(violations).toEqual([])
  })

  // A saying's `wordForWord` (literal reading) is a SECOND line under the meaning — it must add the
  // literal image, never merely restate the meaning (`translation`). A redundant literal just repeats
  // the answer, so we author it as absent in that case. Compared loosely (case/whitespace/terminal
  // punctuation-insensitive) so trivial formatting differences don't sneak a duplicate through.
  it('never gives a phrase a wordForWord that just restates its translation', () => {
    const norm = (s: string) => s.toLowerCase().replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim()
    const redundant: string[] = []
    for (const e of seed.entries) {
      if (e.pos !== 'phrase' || !e.wordForWord) continue
      if (norm(e.wordForWord) === norm(e.translation)) redundant.push(e.lemma)
    }
    expect(redundant).toEqual([])
  })
})

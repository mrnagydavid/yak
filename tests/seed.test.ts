import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface SeedEntry {
  lemma: string
  pos: string
  cefr: string
  gender?: string
  translation: string
  examples?: string[]
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
})

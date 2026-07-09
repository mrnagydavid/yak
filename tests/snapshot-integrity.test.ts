import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Companion to seed-reproducible.test.ts. That test proves the shipped seed is exactly what packing the
// snapshot produces. This one proves the snapshot itself is internally sound and the shipped seed obeys
// the content policies (SNAPSHOT-PIPELINE-DESIGN.md §6). The old layer-internals checks (orphan keys,
// field ownership, one-record-per-layer, drop-is-absent, "nothing stale") are gone — they tested the
// archived layered machinery, which no longer exists on the day-to-day path. One file, one value per
// field, so those failure modes can't occur.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => JSON.parse(readFileSync(join(repoRoot, p), 'utf-8'))

// Run an audit script that prints a JSON report and exits non-zero on any violation; return the parsed
// report either way (the script writes its JSON to stdout before exiting).
function auditJson(script: string): { count: number; violations?: string[] } {
  try {
    return JSON.parse(execFileSync('node', [`scripts/seed/${script}`, '--json'], { cwd: repoRoot, encoding: 'utf-8' }))
  } catch (e) {
    return JSON.parse((e as { stdout?: string }).stdout ?? '{}')
  }
}

describe('the snapshot has valid IDs', () => {
  type Entry = { seedKey: number; lemma?: string; altMeanings?: { key: number }[] }
  const wordlist = read('data/seed/sv/wordlist.json') as Entry[]

  it('every entry has a seedKey', () => {
    const missing = wordlist.map((e, i) => (typeof e.seedKey === 'number' ? null : i)).filter((i) => i !== null)
    expect(missing, `entries at these indices have no numeric seedKey: ${missing.join(', ')}`).toEqual([])
  })

  it('seedKeys are unique (seed-sync matches learner progress on (seedKey, meaningKey) — a dup corrupts it)', () => {
    const seen = new Set<number>()
    const dupes: number[] = []
    for (const e of wordlist) {
      if (seen.has(e.seedKey)) dupes.push(e.seedKey)
      seen.add(e.seedKey)
    }
    expect(dupes, `duplicate seedKeys: ${dupes.join(', ')}`).toEqual([])
  })

  it('every altMeanings[].key is >= 1 and unique within its entry (meaningKey 0 is the primary)', () => {
    const bad: string[] = []
    for (const e of wordlist) {
      const keys = (e.altMeanings ?? []).map((m) => m.key)
      for (const k of keys) if (!(Number.isInteger(k) && k >= 1)) bad.push(`${e.lemma} (id ${e.seedKey}): altMeaning key ${k} (must be an integer >= 1)`)
      if (new Set(keys).size !== keys.length) bad.push(`${e.lemma} (id ${e.seedKey}): duplicate altMeaning keys [${keys.join(', ')}]`)
    }
    expect(bad, `invalid altMeaning keys:\n  ${bad.slice(0, 20).join('\n  ')}`).toEqual([])
  })
})

describe('the shipped seed is grouping-consistent (audit-gloss)', () => {
  it('every ≥2-producer concept is labelled; single-sense carries no gloss, multi-sense a non-echo gloss', () => {
    // Grouping consistency (SNAPSHOT-PIPELINE-DESIGN.md §6.1): concepts are detected mechanically from
    // the seed (groupConcepts + token-synonyms), and each producer's group label + gloss are read from
    // the seed's own entries. A blank label in a ≥2-producer concept = an ungrouped member; a gloss on a
    // single-sense concept = an invented hint; a missing gloss in a multi-sense concept = a learner with
    // no disambiguation. All must be zero.
    const { report } = auditJson('audit-gloss.mjs') as unknown as {
      report: { total: number; blankLabel: number; emptyInMultiSense: number; echoes: number; singleSenseWithGloss: number }
    }
    expect(
      report.total,
      `grouping/gloss violations — blankLabel: ${report.blankLabel}, emptyInMultiSense: ${report.emptyInMultiSense}, echoes: ${report.echoes}, singleSenseWithGloss: ${report.singleSenseWithGloss}`,
    ).toBe(0)
  })
})

describe('the shipped seed obeys the "other meanings only" policy (audit-subdefs)', () => {
  it('no subDefinitions list bare-repeats the main or a promoted meaning', () => {
    // Reference-list analogue of the gloss audit (§4.8): subDefinitions holds the word's OTHER meanings,
    // so a shipped item that is a BARE (parenthetical-free) restatement of the main translation or a
    // promoted altMeaning is a policy violation. Parenthetical-distinguished senses are exempt.
    const { count, violations = [] } = auditJson('audit-subdefs.mjs')
    expect(count, `subDefinitions items repeating the main/promoted meaning:\n  ${violations.slice(0, 20).join('\n  ')}`).toBe(0)
  })
})

describe('the shipped seed gives every split meaning its own example (audit-examples)', () => {
  it('every main meaning of a split-with-examples word has a sense-specific example', () => {
    // Per-sense example policy (§4.8): a split word that has any example must have one for the primary
    // AND each promoted meaning, so a production card never shows another sense's sentence.
    const { count, violations = [] } = auditJson('audit-examples.mjs')
    expect(count, `split meanings missing a sense-specific example:\n  ${violations.slice(0, 20).join('\n  ')}`).toBe(0)
  })
})

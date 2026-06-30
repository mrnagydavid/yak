import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Companion to seed-reproducible.test.ts. That test proves the seed is *reproducible* from the
// committed inputs (no hand-patched output). This one proves the inputs don't silently *cancel each
// other out* — the failure mode where a fix is authored in one overlay but never reaches production
// because another overlay outranks it (SPEC §9.4). Reproducibility can't catch this: a seed built
// from contradictory inputs is still perfectly deterministic, it just doesn't match intent.
//
// The decision overlays (`decisions/*.json` + `translation-decisions.json`) are all keyed by kellyId
// and merged with a fixed precedence in apply-decisions.mjs. The invariants below keep that merge
// honest.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => JSON.parse(readFileSync(join(repoRoot, p), 'utf-8'))

type Decision = { kellyId: number; lemma?: string; decision: 'keep' | 'fix' | 'drop' }

const DECISIONS_DIR = 'data/intermediate/decisions'
const decisionFiles = readdirSync(join(repoRoot, DECISIONS_DIR))
  .filter((f) => f.endsWith('.json'))
  .sort()

// kellyId -> { file, decision } across every decisions/ file (the cleaner/pos/subdef/manual passes).
const decisionsByFile: { file: string; d: Decision }[] = []
for (const file of decisionFiles) {
  for (const d of read(`${DECISIONS_DIR}/${file}`) as Decision[]) decisionsByFile.push({ file, d })
}

const translationDecisions = read('data/intermediate/translation-decisions.json') as Decision[]
const candidateIds = new Set((read('data/intermediate/candidates.json') as { kellyId: number }[]).map((c) => c.kellyId))
const seed = read('data/seed-sv.json') as { entries: { seedKey: number; lemma: string }[] }
const seedKeys = new Set(seed.entries.map((e) => e.seedKey))

describe('seed decision overlays are internally consistent', () => {
  it('no kellyId carries contradictory verdicts (drop vs keep/fix) across decisions/ files', () => {
    // A later pass that emits keep/fix for a kellyId an earlier pass dropped (or vice versa) silently
    // resurrects or kills a card depending only on filename order. Force a human to resolve it by
    // editing the inputs so exactly one verdict survives.
    const verdicts = new Map<number, { file: string; decision: string; lemma?: string }[]>()
    for (const { file, d } of decisionsByFile) {
      if (!verdicts.has(d.kellyId)) verdicts.set(d.kellyId, [])
      verdicts.get(d.kellyId)!.push({ file, decision: d.decision, lemma: d.lemma })
    }
    const conflicts: string[] = []
    for (const [kellyId, vs] of verdicts) {
      const kinds = new Set(vs.map((v) => v.decision))
      if (kinds.has('drop') && (kinds.has('keep') || kinds.has('fix'))) {
        const lemma = vs.find((v) => v.lemma)?.lemma ?? '?'
        conflicts.push(`${lemma} (id ${kellyId}): ${vs.map((v) => `${v.file}=${v.decision}`).join(', ')}`)
      }
    }
    expect(conflicts, `Contradictory verdicts — resolve in the input files so one verdict remains:\n  ${conflicts.join('\n  ')}`).toEqual([])
  })

  it('every dropped kellyId is actually absent from the built seed', () => {
    // Output-side check: even if precedence or collapseDuplicates changes, a card marked drop must not
    // ship. (Catches the same class as the verdict check, from the other end.)
    const leaked = decisionsByFile
      .filter(({ d }) => d.decision === 'drop' && seedKeys.has(d.kellyId))
      .map(({ d }) => `${d.lemma ?? '?'} (id ${d.kellyId})`)
    expect(leaked, `These cards are marked drop but still appear in seed-sv.json: ${leaked.join(', ')}`).toEqual([])
  })

  it('every decision references a kellyId that still exists in candidates.json', () => {
    // Decisions are keyed by kellyId; if a source-dump refresh reshuffles ids, a decision can orphan
    // (target nothing) or, worse, hit the wrong word. This pins the keys to the committed candidates.
    const orphans: string[] = []
    for (const { file, d } of decisionsByFile) if (!candidateIds.has(d.kellyId)) orphans.push(`${file}: id ${d.kellyId}`)
    for (const d of translationDecisions) if (!candidateIds.has(d.kellyId)) orphans.push(`translation-decisions.json: id ${d.kellyId}`)
    expect(orphans, `Decisions point at kellyIds absent from candidates.json (stale after a dump bump?): ${orphans.slice(0, 20).join(', ')}`).toEqual([])
  })
})

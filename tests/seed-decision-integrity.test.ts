import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// Companion to seed-reproducible.test.ts. That test proves the seed is *reproducible* from the
// committed inputs (no hand-patched output). This one proves the layer inputs are internally sound:
// keys point at real base words, each layer owns only its declared fields, no key is duplicated
// within a layer, a dropped word never ships, and a clean build has nothing stale.
//
// The old "no contradictory verdicts" check is gone: precedence is now explicit (higher layer wins
// wholesale, SEED-PIPELINE-DESIGN.md §4.4), so a higher `keep` legitimately overrides a lower `drop`.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => JSON.parse(readFileSync(join(repoRoot, p), 'utf-8'))

const SEED_DIR = 'data/seed/sv'
type Layer = { id: number; name: string; kind: string; produces: string[] }
const manifest = read(`${SEED_DIR}/layers.json`) as Layer[]
const layerDir = (l: Layer) => `${SEED_DIR}/layers/${l.id}-${l.name}`
const keyName = (l: Layer) => (l.kind === 'senses' ? 'english' : 'kellyId')

// A layer's top-level decision file(s), the same set the reducer's loadLayerById reads: decisions.json
// for the LLM layers (40/50/60), the numbered files for the human/cleaner layers (10/20/30/90). runs/
// (a subdir) and the generated stale.json are excluded.
function layerFiles(l: Layer): string[] {
  const dir = join(repoRoot, layerDir(l))
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'stale.json')
    .sort()
}
const layerRecords = (l: Layer) => layerFiles(l).flatMap((f) => read(`${layerDir(l)}/${f}`) as Record<string, unknown>[])

// Which seed fields a record writes — used to enforce the manifest's `produces` ownership.
function writesOf(l: Layer, r: Record<string, unknown>): string[] {
  if (l.kind === 'decisions') {
    const w: string[] = []
    if (r.decision === 'drop') w.push('drop')
    if (r.proposedTranslation) w.push('translation')
    if (r.proposedSubDefinitions) w.push('subDefinitions')
    if (r.proposedIpa) w.push('ipa')
    if (r.svUncountable) w.push('svUncountable')
    return w
  }
  if (l.kind === 'translation') {
    const w: string[] = []
    if (r.translation) w.push('translation')
    if (Array.isArray(r.senses)) w.push('subDefinitions')
    if (r.uncountable) w.push('enUncountable')
    return w
  }
  if (l.kind === 'senses') return ['sense']
  if (l.kind === 'examples') return Array.isArray(r.examples) ? ['examples'] : []
  return []
}

const baseIds = new Set((read(`${SEED_DIR}/base.json`) as { kellyId: number }[]).map((c) => c.kellyId))
const seedKeys = new Set((read(`${SEED_DIR}/seed-sv.json`) as { entries: { seedKey: number }[] }).entries.map((e) => e.seedKey))
const decisionLayers = manifest.filter((l) => l.kind === 'decisions')
const llmLayers = manifest.filter((l) => ['translation', 'senses', 'examples'].includes(l.kind))

describe('seed layer inputs are internally consistent', () => {
  it('every layer record references a kellyId present in base.json', () => {
    const orphans: string[] = []
    for (const l of manifest)
      for (const f of layerFiles(l))
        for (const r of read(`${layerDir(l)}/${f}`) as { kellyId?: number; english?: string; senses?: { members?: number[] }[] }[]) {
          if (l.kind === 'senses') {
            for (const s of r.senses ?? []) for (const m of s.members ?? []) if (!baseIds.has(m)) orphans.push(`${l.name}/${f}: member ${m} (${r.english})`)
          } else if (!baseIds.has(r.kellyId!)) orphans.push(`${l.name}/${f}: id ${r.kellyId}`)
        }
    expect(orphans, `Layer records point at kellyIds absent from base.json (stale after a dump bump?): ${orphans.slice(0, 20).join(', ')}`).toEqual([])
  })

  it('no layer writes a field outside its manifest `produces` set (kills the #4 two-layers-fight-over-the-list bug)', () => {
    const violations: string[] = []
    for (const l of manifest) {
      const allowed = new Set(l.produces)
      if (allowed.has('*')) continue // manual may override anything
      for (const r of layerRecords(l))
        for (const f of writesOf(l, r)) if (!allowed.has(f)) violations.push(`${l.name} writes '${f}' (allowed: ${l.produces.join(', ')}) on ${keyName(l)}=${r[keyName(l)]}`)
    }
    expect(violations, `Layers writing fields they don't own:\n  ${violations.slice(0, 20).join('\n  ')}`).toEqual([])
  })

  it('the compiled view of each layer has a key at most once (replaces the brittle contradictory-verdict check)', () => {
    // The reducer merges a layer's files last-wins, so the *compiled view* is what matters. For the LLM
    // layers that view is the committed decisions.json — a dup there is a compile bug (ambiguous which
    // answer wins). The human/cleaner layers legitimately refine a word across batch files (last wins),
    // so only a dup *within a single file* is a fault there.
    const dupes: string[] = []
    for (const l of manifest) {
      const files = l.kind === 'decisions' ? layerFiles(l) : ['decisions.json'] // LLM layer's compiled view is one file
      for (const f of files) {
        if (!existsSync(join(repoRoot, layerDir(l), f))) continue
        const seen = new Set<unknown>()
        for (const r of read(`${layerDir(l)}/${f}`) as Record<string, unknown>[]) {
          const k = r[keyName(l)]
          if (seen.has(k)) dupes.push(`${l.name}/${f}: duplicate ${keyName(l)}=${k}`)
          seen.add(k)
        }
      }
    }
    expect(dupes, `A key is written twice in one file — merge the records:\n  ${dupes.slice(0, 20).join('\n  ')}`).toEqual([])
  })

  it('every kellyId resolved to drop is absent from the built seed', () => {
    const resolved = new Map<number, string>()
    for (const l of decisionLayers) for (const r of layerRecords(l) as { kellyId: number; decision: string }[]) resolved.set(r.kellyId, r.decision)
    const leaked = [...resolved].filter(([id, d]) => d === 'drop' && seedKeys.has(id)).map(([id]) => `id ${id}`)
    expect(leaked, `These cards are marked drop but still appear in seed-sv.json: ${leaked.join(', ')}`).toEqual([])
  })
})

describe('a clean build has nothing stale', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'seed-stale-'))
  afterAll(() => rmSync(outDir, { recursive: true, force: true }))

  it('every committed LLM answer is based on current input (stale.json empty for all layers)', () => {
    // Recompute staleness fresh (SEED_OUT_DIR redirects the reports off the repo copy), then assert
    // each layer's report is empty. Turns "did we forget to re-curate after a change?" into red/green.
    execFileSync('node', ['scripts/seed/stale.mjs'], { cwd: repoRoot, env: { ...process.env, SEED_OUT_DIR: outDir }, stdio: 'ignore' })
    const stale: string[] = []
    for (const l of llmLayers) {
      const report = JSON.parse(readFileSync(join(outDir, layerDir(l), 'stale.json'), 'utf-8')) as unknown[]
      if (report.length) stale.push(`${l.name}: ${report.length} stale`)
    }
    expect(stale, `Layers have stale decisions — run \`pnpm seed:stale\` and re-curate the listed words: ${stale.join(', ')}`).toEqual([])
  }, 60_000)
})

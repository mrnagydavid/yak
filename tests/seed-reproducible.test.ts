import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// Guard against the SPEC §9.4 invariant "fixes live in the inputs, never the output": the committed
// data/seed-sv.json must be exactly what `seed:apply` produces from the committed inputs
// (candidates.json + the decisions/examples/sense/translation files). If a fix is ever applied to the
// output but not saved as a decision — as happened with the lost pilot fixes for misshandel/län/gud/
// lämpa sig — this test fails, because re-applying from the inputs no longer reproduces the seed.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const committed = JSON.parse(readFileSync(join(repoRoot, 'data/seed-sv.json'), 'utf-8'))

describe('seed-sv.json is reproducible from committed inputs', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'seed-verify-'))
  afterAll(() => rmSync(outDir, { recursive: true, force: true }))

  it('re-running apply-decisions reproduces the committed entries and version', () => {
    // SEED_OUT_DIR redirects every generated file under outDir, so this never touches the repo copy.
    execFileSync('node', ['scripts/seed/apply-decisions.mjs'], {
      cwd: repoRoot,
      env: { ...process.env, SEED_OUT_DIR: outDir },
      stdio: 'ignore',
    })
    const regenerated = JSON.parse(readFileSync(join(outDir, 'data/seed-sv.json'), 'utf-8'))

    expect(regenerated.count).toBe(committed.count)

    // Per-entry diagnostics first (a friendly list of offending lemmas), then the authoritative check.
    const byKey = new Map(regenerated.entries.map((e: { seedKey: number }) => [e.seedKey, e]))
    const mismatches: string[] = []
    for (const e of committed.entries) {
      if (JSON.stringify(byKey.get(e.seedKey)) !== JSON.stringify(e)) {
        mismatches.push(`${e.lemma} (${e.pos}, id ${e.seedKey})`)
        if (mismatches.length >= 10) break
      }
    }
    expect(
      mismatches,
      `seed-sv.json is not reproducible from committed inputs — run \`pnpm seed:apply\` and commit the result. Divergent: ${mismatches.join(', ')}`,
    ).toEqual([])

    // version embeds a content hash of the full (ordered) entries array, so this also catches reordering
    // and any entry added/removed that the per-key scan above would miss. generatedAt is intentionally
    // excluded — it is the only non-deterministic field.
    expect(regenerated.version).toBe(committed.version)
  }, 60_000)
})

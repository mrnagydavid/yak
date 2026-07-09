import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// Guard the snapshot pipeline's core invariant (SNAPSHOT-PIPELINE-DESIGN.md §6): the committed
// data/seed/sv/seed-sv.json must be exactly what `seed:pack` produces from the hand-edited snapshot
// (data/seed/sv/wordlist.json). If a fix is ever applied to the shipped output but not to the snapshot
// — or the snapshot is edited without re-packing — this test fails, because re-packing no longer
// reproduces the committed seed. `pack` re-derives ipaAmbiguous + the per-entry hash + the version and
// re-serializes through one fixed key order, so hand-reordering keys in wordlist.json can't drift it.
//
// NOTE: this compares against the COMMITTED seed-sv.json, so it does NOT guard content-neutrality of a
// migration — once you re-pack, any content edit in wordlist.json is trivially self-consistent here and
// passes. A one-time content-neutral migration must be verified by diffing against the FROZEN
// pre-migration baseline (SNAPSHOT-PIPELINE-DESIGN.md §8.1), not this test.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const committed = JSON.parse(readFileSync(join(repoRoot, 'data/seed/sv/seed-sv.json'), 'utf-8'))

describe('seed-sv.json is reproducible by packing the snapshot', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'seed-verify-'))
  afterAll(() => rmSync(outDir, { recursive: true, force: true }))

  it('re-running seed:pack reproduces the committed entries and version', () => {
    // SEED_OUT_DIR redirects every generated file under outDir, so this never touches the repo copy.
    execFileSync('node', ['scripts/seed/pack.mjs'], {
      cwd: repoRoot,
      env: { ...process.env, SEED_OUT_DIR: outDir },
      stdio: 'ignore',
    })
    const regenerated = JSON.parse(readFileSync(join(outDir, 'data/seed/sv/seed-sv.json'), 'utf-8'))

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
      `seed-sv.json is not reproducible from wordlist.json — run \`pnpm seed:pack\` and commit the result. Divergent: ${mismatches.join(', ')}`,
    ).toEqual([])

    // version embeds a content hash of the full (ordered) entries array, so this also catches reordering
    // and any entry added/removed that the per-key scan above would miss. generatedAt is intentionally
    // excluded — it is the only non-deterministic field.
    expect(regenerated.version).toBe(committed.version)
  }, 60_000)
})

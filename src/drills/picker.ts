import { boxWeight } from './box'

// Composes a drill batch: a weighted random sample of candidate words, favouring low boxes. Pure and
// dependency-free (imports only the box weighting) so the draw is unit-testable with an injected RNG.

/** Default batch size for a drill session — enough to be worthwhile, short enough to finish. */
export const DRILL_BATCH_SIZE = 20

/** A word eligible for a drill, with its current box (unseen → 0, the top-priority weight). */
export interface DrillCandidate {
  entryId: string
  box: number
}

/**
 * Weighted sample WITHOUT replacement, via Efraimidis–Spirakis: give each candidate the key
 * `u^(1/w)` (u uniform in [0,1), w its box weight) and take the largest keys. A higher weight pushes
 * the key toward 1, so low-box/unseen words dominate the batch while mastered words appear only
 * occasionally — the same reservoir trick the session composer uses for calibration bands.
 *
 * `rng` is injectable so tests are deterministic; it defaults to `Math.random`.
 */
export function pickBatch(
  candidates: DrillCandidate[],
  size: number = DRILL_BATCH_SIZE,
  rng: () => number = Math.random,
): string[] {
  return candidates
    .map((c) => ({ entryId: c.entryId, key: rng() ** (1 / boxWeight(c.box)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, Math.max(0, size))
    .map((c) => c.entryId)
}

import { describe, expect, it } from 'vitest'
import { type DrillCandidate, pickBatch } from '../src/drills/picker'

/** Deterministic RNG: yields the given values in order (cycling). */
function seq(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('drill picker', () => {
  it('returns at most `size` distinct entries', () => {
    const cands: DrillCandidate[] = Array.from({ length: 50 }, (_, i) => ({ entryId: `e${i}`, box: 0 }))
    const batch = pickBatch(cands, 20, seq([0.5]))
    expect(batch).toHaveLength(20)
    expect(new Set(batch).size).toBe(20)
  })

  it('returns everything when there are fewer candidates than `size`', () => {
    const cands: DrillCandidate[] = [
      { entryId: 'a', box: 0 },
      { entryId: 'b', box: 5 },
    ]
    expect(pickBatch(cands, 20).sort()).toEqual(['a', 'b'])
  })

  it('favours a low-box word over a mastered one for equal luck', () => {
    const cands: DrillCandidate[] = [
      { entryId: 'low', box: 0 },
      { entryId: 'high', box: 8 },
    ]
    // Same u for both: the higher weight (low box) yields the larger key.
    expect(pickBatch(cands, 1, () => 0.5)).toEqual(['low'])
  })

  it('still lets a mastered word through with enough luck (never excluded)', () => {
    const cands: DrillCandidate[] = [
      { entryId: 'low', box: 0 },
      { entryId: 'high', box: 8 },
    ]
    // low draws a mediocre u, high draws the best possible → high wins this draw.
    expect(pickBatch(cands, 1, seq([0.5, 1]))).toEqual(['high'])
  })

  it('handles an empty candidate list', () => {
    expect(pickBatch([], 20)).toEqual([])
  })
})

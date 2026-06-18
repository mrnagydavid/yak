import { describe, expect, it } from 'vitest'
import { planSeedSync, type SyncTarget } from '../src/db/seed'

// Minimal seed-entry factory (only the fields planSeedSync reads matter).
const seed = (seedKey: number, lemma: string, pos = 'noun', translation = 'x') =>
  ({ seedKey, lemma, pos, cefr: 'A1', translation }) as never

describe('planSeedSync — update/add/delete by seedKey', () => {
  it('updates a card whose seedKey is unchanged', () => {
    const existing: SyncTarget[] = [{ id: 'a', seedKey: 1, lemma: 'hund', pos: 'noun' }]
    const plan = planSeedSync(existing, [seed(1, 'hund')])
    expect(plan.updates).toEqual([{ id: 'a', seed: seed(1, 'hund') }])
    expect(plan.adds).toEqual([])
    expect(plan.deletes).toEqual([])
  })

  it('adds a new seedKey', () => {
    const plan = planSeedSync([], [seed(2, 'katt')])
    expect(plan.adds).toEqual([seed(2, 'katt')])
    expect(plan.updates).toEqual([])
  })

  it('deletes a card whose seedKey is gone from the seed', () => {
    const existing: SyncTarget[] = [{ id: 'a', seedKey: 9, lemma: 'gammal', pos: 'adj' }]
    const plan = planSeedSync(existing, [])
    expect(plan.deletes).toEqual(['a'])
    expect(plan.updates).toEqual([])
  })

  it('handles a mixed update + add + delete', () => {
    const existing: SyncTarget[] = [
      { id: 'a', seedKey: 1, lemma: 'x', pos: 'noun' },
      { id: 'b', seedKey: 2, lemma: 'y', pos: 'noun' },
    ]
    const plan = planSeedSync(existing, [seed(1, 'x'), seed(3, 'z')])
    expect(plan.updates.map((u) => u.id)).toEqual(['a'])
    expect(plan.deletes).toEqual(['b'])
    expect(plan.adds.map((s) => s.seedKey)).toEqual([3])
  })

  it('drops an entry that has no seedKey (foreign/stale — re-seed once to establish the baseline)', () => {
    const existing: SyncTarget[] = [{ id: 'a', lemma: 'fast', pos: 'conj' }]
    const plan = planSeedSync(existing, [seed(5, 'fast', 'conj')])
    expect(plan.deletes).toEqual(['a'])
    expect(plan.adds.map((s) => s.seedKey)).toEqual([5])
    expect(plan.updates).toEqual([])
  })
})

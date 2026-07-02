import { describe, expect, it } from 'vitest'
import { planMeaningSync, planSeedSync, type SyncTarget } from '../src/db/seed'

// Minimal seed-entry factory (only the fields planSeedSync reads matter: seedKey + `h`).
const seed = (seedKey: number, lemma: string, pos = 'noun', translation = 'x', h = 'h') =>
  ({ seedKey, lemma, pos, cefr: 'A1', translation, h }) as never

describe('planSeedSync — changed-only update/add/delete by seedKey', () => {
  it('updates a matched card whose content hash changed', () => {
    const existing: SyncTarget[] = [{ id: 'a', seedKey: 1, seedHash: 'old', lemma: 'hund', pos: 'noun' }]
    const plan = planSeedSync(existing, [seed(1, 'hund', 'noun', 'dog', 'new')])
    expect(plan.updates).toEqual([{ id: 'a', seed: seed(1, 'hund', 'noun', 'dog', 'new') }])
    expect(plan.adds).toEqual([])
    expect(plan.deletes).toEqual([])
  })

  it('skips a matched card whose content hash is unchanged (changed-only sync)', () => {
    const existing: SyncTarget[] = [{ id: 'a', seedKey: 1, seedHash: 'h', lemma: 'hund', pos: 'noun' }]
    const plan = planSeedSync(existing, [seed(1, 'hund')]) // factory default h = 'h' → no change
    expect(plan.updates).toEqual([])
    expect(plan.adds).toEqual([])
    expect(plan.deletes).toEqual([])
  })

  it('updates a matched card that has no stored hash yet (pre-hash DB backfill)', () => {
    const existing: SyncTarget[] = [{ id: 'a', seedKey: 1, lemma: 'hund', pos: 'noun' }] // no seedHash
    const plan = planSeedSync(existing, [seed(1, 'hund')])
    expect(plan.updates.map((u) => u.id)).toEqual(['a'])
  })

  it('adds a new seedKey', () => {
    const plan = planSeedSync([], [seed(2, 'katt')])
    expect(plan.adds).toEqual([seed(2, 'katt')])
    expect(plan.updates).toEqual([])
  })

  it('deletes a card whose seedKey is gone from the seed', () => {
    const existing: SyncTarget[] = [{ id: 'a', seedKey: 9, seedHash: 'h', lemma: 'gammal', pos: 'adj' }]
    const plan = planSeedSync(existing, [])
    expect(plan.deletes).toEqual(['a'])
    expect(plan.updates).toEqual([])
  })

  it('handles a mixed change + add + delete', () => {
    const existing: SyncTarget[] = [
      { id: 'a', seedKey: 1, seedHash: 'old', lemma: 'x', pos: 'noun' },
      { id: 'b', seedKey: 2, seedHash: 'old', lemma: 'y', pos: 'noun' },
    ]
    const plan = planSeedSync(existing, [seed(1, 'x', 'noun', 'x', 'new'), seed(3, 'z')])
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

// The multi-meaning upgrade path: when a synced entry's meanings change, reconcile the set of
// translation links by meaningKey so a learner's progress on a KEPT meaning is never lost.
describe('planMeaningSync — reconcile a word’s meaning links by meaningKey', () => {
  const ex = (id: string, meaningKey: number, primary: boolean) => ({ id, nativeEntryId: `n_${id}`, meaningKey, primary })
  const m = (key: number, translation: string, enUncountable = false) => ({ key, translation, enUncountable })

  it('updates matched meanings in place — the link id (and its ReviewState) survives', () => {
    const existing = [ex('t0', 0, true), ex('t1', 1, false)]
    const plan = planMeaningSync(existing, [m(0, 'joint'), m(1, 'route, trail')])
    expect(plan.updates.map((u) => u.id)).toEqual(['t0', 't1']) // both kept, same ids
    expect(plan.updates.map((u) => u.meaning.translation)).toEqual(['joint', 'route, trail'])
    expect(plan.adds).toEqual([])
    expect(plan.deletes).toEqual([])
  })

  it('adds a newly-promoted meaning (a fresh key not present today)', () => {
    const plan = planMeaningSync([ex('t0', 0, true)], [m(0, 'joint'), m(1, 'route, trail')])
    expect(plan.updates.map((u) => u.id)).toEqual(['t0'])
    expect(plan.adds).toEqual([m(1, 'route, trail')])
    expect(plan.deletes).toEqual([])
  })

  it('deletes a meaning removed from the seed (its native entry + review states go with it)', () => {
    const existing = [ex('t0', 0, true), ex('t1', 1, false)]
    const plan = planMeaningSync(existing, [m(0, 'forehead, brow')])
    expect(plan.updates.map((u) => u.id)).toEqual(['t0'])
    expect(plan.adds).toEqual([])
    expect(plan.deletes).toEqual([{ id: 't1', nativeEntryId: 'n_t1' }])
  })

  it('backfills the primary flag on a matched link only when it must flip', () => {
    // A pre-v6 link that was never stamped primary (defensive) flips; a correct one is left untouched.
    const plan = planMeaningSync([ex('t0', 0, false), ex('t1', 1, false)], [m(0, 'x'), m(1, 'y')])
    expect(plan.updates.find((u) => u.id === 't0')?.setPrimary).toBe(true) // meaningKey 0 → primary
    expect(plan.updates.find((u) => u.id === 't1')).toMatchObject({ id: 't1' })
    expect(plan.updates.find((u) => u.id === 't1')?.setPrimary).toBeUndefined() // already correct
  })

  it('handles a full reshuffle: keep primary, drop one meaning, add another', () => {
    const existing = [ex('t0', 0, true), ex('t1', 1, false)]
    const plan = planMeaningSync(existing, [m(0, 'pan'), m(2, 'boiler')])
    expect(plan.updates.map((u) => u.id)).toEqual(['t0'])
    expect(plan.deletes).toEqual([{ id: 't1', nativeEntryId: 'n_t1' }])
    expect(plan.adds).toEqual([m(2, 'boiler')])
  })
})

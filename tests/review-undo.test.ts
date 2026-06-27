import { beforeEach, describe, expect, it, vi } from 'vitest'

// recordReview / undoReview are the only DB-backed SRS functions; the rest of the suite stays
// pure. Rather than pull in a fake-IndexedDB dependency, stand in a tiny in-memory reviewStates
// table (id → row) so the round-trip can be asserted directly.
const { store } = vi.hoisted(() => ({ store: new Map<string, unknown>() }))
vi.mock('../src/db/schema', () => ({
  db: {
    reviewStates: {
      // Clone on write, like a real store, so callers can't alias what we hold.
      put: async (row: { id: string }) => void store.set(row.id, JSON.parse(JSON.stringify(row))),
      delete: async (id: string) => void store.delete(id),
    },
  },
}))

import { applyRating, createReviewState } from '../src/srs/fsrs-adapter'
import { recordReview, type SessionCard, undoReview } from '../src/srs/session-composer'

const NOW = Date.UTC(2026, 0, 1)
const DAY = 86_400_000

beforeEach(() => store.clear())

/** A settled practice row (created, then reviewed once) as it would live in the DB. */
function seedPractice(translationId: string) {
  const fresh = createReviewState(translationId, 'recognize', NOW - 10 * DAY)
  const row = applyRating(fresh, 'good', NOW - 9 * DAY)
  store.set(row.id, JSON.parse(JSON.stringify(row)))
  return row
}

function practiceCard(row: ReturnType<typeof seedPractice>): SessionCard {
  return {
    translationId: row.translationId,
    targetEntryId: `e-${row.translationId}`,
    skill: 'recognize',
    mode: 'practice',
    reviewState: row,
  }
}

describe('undoReview — reversing an accidental rating', () => {
  it('restores a practice card to its exact pre-rating row', async () => {
    const prior = seedPractice('t-practice')

    const token = await recordReview(practiceCard(prior), 'again', NOW)
    expect(token.previous).toBe(prior)
    expect(store.get(prior.id)).not.toEqual(prior) // the rating moved scheduling on

    await undoReview(token)
    expect(store.get(prior.id)).toEqual(prior) // ...and undo puts it back byte-for-byte
  })

  it('deletes the row a new card created, leaving it unseen again', async () => {
    const card: SessionCard = {
      translationId: 't-new',
      targetEntryId: 'e-new',
      skill: 'recognize',
      mode: 'new', // no reviewState — recordReview creates the row
    }

    const token = await recordReview(card, 'good', NOW)
    expect(token.previous).toBeUndefined()
    expect(store.get(token.writtenId)).toBeDefined()

    await undoReview(token)
    expect(store.get(token.writtenId)).toBeUndefined()
  })

  it('undoes the most recent ratings only (multi-step, LIFO)', async () => {
    const priors = ['a', 'b', 'c'].map((id) => seedPractice(`t-${id}`))

    const tokens = []
    for (const p of priors) tokens.push(await recordReview(practiceCard(p), 'again', NOW))

    // Walk back the last two, as the back button would.
    await undoReview(tokens[2])
    await undoReview(tokens[1])

    expect(store.get(priors[0].id)).not.toEqual(priors[0]) // first rating stands
    expect(store.get(priors[1].id)).toEqual(priors[1]) // reverted
    expect(store.get(priors[2].id)).toEqual(priors[2]) // reverted
  })
})

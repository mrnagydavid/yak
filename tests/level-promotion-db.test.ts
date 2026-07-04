import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyLevelPromotion,
  createProfile,
  getActiveProfile,
  getPendingPromotion,
  snoozePromotion,
} from '../src/db/queries'
import { db } from '../src/db/schema'
import type { Cefr, Entry, ReviewState, ReviewStateName, Translation } from '../src/db/types'

// End-to-end over the real Dexie schema (fake-indexeddb): the level-up glue loads the active profile's
// language, decides whether the band above is cleared, and round-trips the per-day snooze via `meta`.
// The trigger/snooze logic itself is unit-tested in level-progress.test.ts; this proves the wiring.

const DAY = 86_400_000
const NOW = Date.UTC(2026, 0, 1, 12)
const SNOOZE_KEY = 'levelPromotionSnooze'

async function reset(): Promise<void> {
  await Promise.all([db.profiles.clear(), db.entries.clear(), db.translations.clear(), db.reviewStates.clear(), db.meta.clear()])
}

function entryRow(id: string, cefr: Cefr): Entry {
  return {
    id,
    lang: 'sv',
    lemma: id,
    pos: 'noun',
    features: {},
    inflections: {},
    pronunciation: {},
    source: 'seed',
    cefr,
    study: 'auto',
    createdAt: 0,
    updatedAt: 0,
  }
}

function trRow(id: string, targetEntryId: string): Translation {
  return { id, targetEntryId, nativeEntryId: `n_${id}`, meaningKey: 0, primary: true, source: 'seed', createdAt: 0 }
}

function recRow(translationId: string, s: ReviewStateName): ReviewState {
  return {
    id: `rs_${translationId}`,
    translationId,
    skill: 'recognize',
    difficulty: 0,
    stability: 0,
    reps: 1,
    lapses: 0,
    state: s,
    due: 0,
    lastReview: 0,
    scheduledDays: 0,
    elapsedDays: 0,
    learningSteps: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

async function addWord(id: string, cefr: Cefr, rec?: ReviewStateName): Promise<void> {
  await db.entries.add(entryRow(id, cefr))
  await db.translations.add(trRow(`t_${id}`, id))
  if (rec) await db.reviewStates.add(recRow(`t_${id}`, rec))
}

beforeEach(reset)

describe('level-up prompt — DB glue', () => {
  it('offers B2 when B1 has cleared the B2 band, then applies and moves the pool up', async () => {
    await createProfile({ learnerLang: 'en', targetLang: 'sv', claimedLevel: 'B1' })
    await addWord('w1', 'B2', 'review')
    await addWord('w2', 'B2', 'review')

    expect(await getPendingPromotion(NOW)).toBe('B2')

    await applyLevelPromotion('B2')
    expect((await getActiveProfile())?.claimedLevel).toBe('B2')
    // Band above is now C1 (no seed words) → nothing more to offer.
    expect(await getPendingPromotion(NOW)).toBeNull()
  })

  it('does not offer while a B2 word is still being learned', async () => {
    await createProfile({ learnerLang: 'en', targetLang: 'sv', claimedLevel: 'B1' })
    await addWord('w1', 'B2', 'review')
    await addWord('w2', 'B2', 'learning')
    expect(await getPendingPromotion(NOW)).toBeNull()
  })

  it('snoozes for the day, then re-asks the next day', async () => {
    await createProfile({ learnerLang: 'en', targetLang: 'sv', claimedLevel: 'B1' })
    await addWord('w1', 'B2', 'review')

    expect(await getPendingPromotion(NOW)).toBe('B2')
    await snoozePromotion('B2', NOW)
    expect(await getPendingPromotion(NOW)).toBeNull() // same day → suppressed
    expect(await getPendingPromotion(NOW + DAY)).toBe('B2') // next day → re-asks
  })

  it('accepting clears the snooze record', async () => {
    await createProfile({ learnerLang: 'en', targetLang: 'sv', claimedLevel: 'A2' })
    await addWord('w1', 'B1', 'review')
    await snoozePromotion('B1', NOW)
    expect(await getPendingPromotion(NOW)).toBeNull()

    await applyLevelPromotion('B1')
    expect(await db.meta.get(SNOOZE_KEY)).toBeUndefined()
  })
})

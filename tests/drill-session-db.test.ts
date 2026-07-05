import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createProfile } from '../src/db/queries'
import { db } from '../src/db/schema'
import type { Entry, ReviewState, Translation } from '../src/db/types'
import {
  endDrillSession,
  getActiveDrillSession,
  getDrillOverview,
  recordDrillAnswer,
  resolveDrillQuestions,
  startDrillSession,
} from '../src/drills/session'

// End-to-end over the real Dexie schema (fake-indexeddb): eligibility, the frozen batch, live box
// updates, the session log, and resume/profile guarding. The pure box/picker/gender rules are covered
// in their own unit tests; this proves the DB wiring.

async function reset(): Promise<void> {
  await Promise.all([
    db.profiles.clear(),
    db.entries.clear(),
    db.translations.clear(),
    db.reviewStates.clear(),
    db.drillStats.clear(),
    db.activeDrillSessions.clear(),
    db.drillSessionLogs.clear(),
  ])
}

function svNoun(id: string, gender?: 'en' | 'ett', pos: Entry['pos'] = 'noun'): Entry {
  return {
    id,
    lang: 'sv',
    lemma: id,
    pos,
    features: gender ? { gender } : {},
    inflections: { definiteSingular: `${id}en`, indefinitePlural: `${id}ar`, definitePlural: `${id}arna` },
    pronunciation: {},
    source: 'seed',
    cefr: 'A1',
    study: 'auto',
    createdAt: 0,
    updatedAt: 0,
  }
}

function enNoun(id: string): Entry {
  return { ...svNoun(id), lang: 'en', features: {}, inflections: {} }
}

function tr(id: string, targetEntryId: string, nativeEntryId: string): Translation {
  return { id, targetEntryId, nativeEntryId, meaningKey: 0, primary: true, source: 'seed', createdAt: 0 }
}

function recognition(translationId: string, reps = 1): ReviewState {
  return {
    id: `rs_${translationId}`,
    translationId,
    skill: 'recognize',
    difficulty: 0,
    stability: 0,
    reps,
    lapses: 0,
    state: 'review',
    due: 0,
    lastReview: 0,
    scheduledDays: 0,
    elapsedDays: 0,
    learningSteps: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

/** Add a noun the learner has already MET (its recognition has been reviewed). */
async function addMetNoun(id: string, gender: 'en' | 'ett'): Promise<void> {
  await db.entries.bulkAdd([svNoun(id, gender), enNoun(`n_${id}`)])
  await db.translations.add(tr(`t_${id}`, id, `n_${id}`))
  await db.reviewStates.add(recognition(`t_${id}`))
}

beforeEach(async () => {
  await reset()
  await createProfile({ learnerLang: 'en', targetLang: 'sv', claimedLevel: 'A1' })
})

describe('gender drill — eligibility', () => {
  it('drills only met nouns that have a gender', async () => {
    await addMetNoun('hund', 'en') // eligible
    await addMetNoun('bord', 'ett') // eligible

    // Unmet noun (no recognition state) → excluded.
    await db.entries.bulkAdd([svNoun('katt', 'en'), enNoun('n_katt')])
    await db.translations.add(tr('t_katt', 'katt', 'n_katt'))

    // Met, but no gender recorded → excluded.
    await db.entries.bulkAdd([svNoun('sak'), enNoun('n_sak')])
    await db.translations.add(tr('t_sak', 'sak', 'n_sak'))
    await db.reviewStates.add(recognition('t_sak'))

    const overview = await getDrillOverview('sv:gender')
    expect(overview?.eligible).toBe(2)
  })
})

describe('gender drill — session lifecycle', () => {
  it('freezes a batch, records answers live, and ends with a log', async () => {
    await addMetNoun('hund', 'en')
    await addMetNoun('bord', 'ett')

    const session = await startDrillSession('sv:gender', Date.now(), () => 0.5)
    expect(session).not.toBeNull()
    expect(session!.queue).toHaveLength(2)
    expect(await getActiveDrillSession()).not.toBeNull() // sticky — persisted

    const questions = await resolveDrillQuestions(session!.queue)
    expect(questions).toHaveLength(2)
    expect(questions[0].gloss).toBeTruthy()

    let s = await recordDrillAnswer(session!, session!.queue[0], true)
    s = await recordDrillAnswer(s, session!.queue[1], false)
    expect(s.index).toBe(2)
    expect(s.cleared).toEqual([session!.queue[0]]) // the right one left the board
    expect(s.missed).toEqual([session!.queue[1]])
    // The missed word is re-queued (appended here, since it was the last card) so it returns.
    expect(s.queue.filter((id) => id === session!.queue[1])).toHaveLength(2)
    expect(s.initialCount).toBe(2) // denominator never grows

    const passed = await db.drillStats.get([session!.queue[0], 'sv:gender'])
    const failed = await db.drillStats.get([session!.queue[1], 'sv:gender'])
    expect(passed?.box).toBe(1)
    expect(failed?.box).toBe(0)

    const log = await endDrillSession(s, false)
    expect(log.words).toBe(2)
    expect(log.cleared).toBe(1)
    expect(log.firstTry).toBe(1)
    expect(log.attempts).toBe(2)
    expect(log.endedEarly).toBe(false)
    expect(await getActiveDrillSession()).toBeNull() // cleared on finish

    const overview = await getDrillOverview('sv:gender')
    expect(overview?.seen).toBe(2)
    expect(overview?.lastSession?.cleared).toBe(1)
  })

  it('keeps a missed word on the board until it is cleared, and excludes it from first-try', async () => {
    await addMetNoun('hund', 'en')

    const s0 = await startDrillSession('sv:gender', Date.now(), () => 0.5)
    expect(s0!.initialCount).toBe(1)

    // Miss it: the word is re-queued (still on the board), so the session is NOT done yet.
    const s1 = await recordDrillAnswer(s0!, 'hund', false)
    expect(s1.cleared).toEqual([])
    expect(s1.missed).toEqual(['hund'])
    expect(s1.index < s1.queue.length).toBe(true) // more to answer — it came back

    // Get it right: the board clears and the cursor reaches the end.
    const s2 = await recordDrillAnswer(s1, 'hund', true)
    expect(s2.cleared).toEqual(['hund'])
    expect(s2.index >= s2.queue.length).toBe(true)

    const log = await endDrillSession(s2, false)
    expect(log.cleared).toBe(1)
    expect(log.firstTry).toBe(0) // it was missed first, so it doesn't count as first-try
    expect(log.attempts).toBe(2)
  })

  it('resets a word to box 0 after a fail, even following earlier passes', async () => {
    await addMetNoun('hund', 'en')

    const a = await startDrillSession('sv:gender', Date.now(), () => 0.5)
    await recordDrillAnswer(a!, 'hund', true) // box 1
    const b = await startDrillSession('sv:gender', Date.now(), () => 0.5)
    await recordDrillAnswer(b!, 'hund', true) // box 2
    const c = await startDrillSession('sv:gender', Date.now(), () => 0.5)
    await recordDrillAnswer(c!, 'hund', false) // box 0

    expect((await db.drillStats.get(['hund', 'sv:gender']))?.box).toBe(0)
  })

  it('counts a mastered word toward the solid tally', async () => {
    await addMetNoun('hund', 'en')
    // Three passes → box 3 → solid.
    for (let i = 0; i < 3; i++) {
      const s = await startDrillSession('sv:gender', Date.now(), () => 0.5)
      await recordDrillAnswer(s!, 'hund', true)
    }
    const overview = await getDrillOverview('sv:gender')
    expect(overview?.solid).toBe(1)
  })

  it('returns null (nothing to start) when no word is eligible', async () => {
    expect(await startDrillSession('sv:gender', Date.now(), () => 0.5)).toBeNull()
    const overview = await getDrillOverview('sv:gender')
    expect(overview?.eligible).toBe(0)
  })

  it('drops a sticky session left over from another profile', async () => {
    await addMetNoun('hund', 'en')
    const s = await startDrillSession('sv:gender', Date.now(), () => 0.5)
    expect(s).not.toBeNull()

    await db.activeDrillSessions.put({ ...s!, profileId: 'someone-else' })
    expect(await getActiveDrillSession()).toBeNull()
    expect(await db.activeDrillSessions.get('active')).toBeUndefined() // and cleaned up
  })
})

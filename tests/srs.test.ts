import { describe, expect, it } from 'vitest'
import { applyRating, createReviewState, isDue } from '../src/srs/fsrs-adapter'
import { composeSessionPure, type ComposerInput } from '../src/srs/session-composer'
import type { Entry, ReviewState, Source, Translation } from '../src/db/types'
import type { Cefr } from '../src/db/types'

const NOW = 1_700_000_000_000
const DAY = 86_400_000

describe('fsrs-adapter', () => {
  it('creates a fresh review state in the "new" state', () => {
    const rs = createReviewState('t1', 'recognize', NOW)
    expect(rs.state).toBe('new')
    expect(rs.reps).toBe(0)
    expect(rs.lapses).toBe(0)
    expect(rs.translationId).toBe('t1')
    expect(rs.skill).toBe('recognize')
    expect(rs.due).toBe(NOW) // createEmptyCard schedules at `now`
  })

  it('advances the card on a "good" rating: reps up, due pushed into the future', () => {
    const created = createReviewState('t1', 'recognize', NOW)
    const rated = applyRating(created, 'good', NOW)
    expect(rated.reps).toBe(1)
    expect(rated.due).toBeGreaterThan(NOW)
    expect(rated.state).not.toBe('new')
    expect(rated.updatedAt).toBe(NOW)
    expect(rated.id).toBe(created.id) // same row, updated in place
  })

  it('schedules a shorter interval for "again" than for "easy"', () => {
    const base = createReviewState('t1', 'recognize', NOW)
    const again = applyRating(base, 'again', NOW)
    const easy = applyRating(base, 'easy', NOW)
    expect(again.due).toBeLessThan(easy.due)
  })

  it('isDue compares due against now', () => {
    const rs = createReviewState('t1', 'recognize', NOW)
    expect(isDue(rs, NOW)).toBe(true)
    expect(isDue(rs, NOW - 1)).toBe(false)
  })
})

// ---- composer fixtures ----

let seq = 0
function entry(lemma: string, source: Source, cefr?: Cefr, extra: Partial<Entry> = {}): Entry {
  seq += 1
  return {
    id: `e${seq}`,
    lang: 'sv',
    lemma,
    pos: 'noun',
    features: {},
    inflections: {},
    pronunciation: {},
    source,
    cefr,
    createdAt: 1000 + seq,
    updatedAt: 1000 + seq,
    ...extra,
  }
}

function translation(id: string, targetEntryId: string): Translation {
  return { id, targetEntryId, nativeEntryId: `n_${targetEntryId}`, source: 'seed', createdAt: 0 }
}

function dueState(translationId: string, skill: 'recognize' | 'produce', dueAt: number): ReviewState {
  return { ...createReviewState(translationId, skill, NOW), due: dueAt }
}

function srsState(
  translationId: string,
  skill: 'recognize' | 'produce',
  fields: Partial<ReviewState>,
): ReviewState {
  return { ...createReviewState(translationId, skill, NOW), ...fields }
}

function base(overrides: Partial<ComposerInput> = {}): ComposerInput {
  return {
    now: NOW,
    dayStart: NOW, // treat NOW as the start of "today" for budgeting
    level: 'A2',
    limits: { newPerDay: 100, practicePerDay: 100 },
    entries: [],
    translations: [],
    reviewStates: [],
    ...overrides,
  }
}

describe('session-composer', () => {
  it('classifies no-SRS entries by CEFR relative to the claimed level', () => {
    seq = 0
    const a1 = entry('a1word', 'seed', 'A1') // <= level → calibration (practice)
    const b1 = entry('b1word', 'seed', 'B1') // == level+1 → new
    const b2 = entry('b2word', 'seed', 'B2') // > level+1 → not eligible
    const usr = entry('userword', 'user') // user-added → new
    const entries = [a1, b1, b2, usr]
    const translations = [
      translation('t_a1', a1.id),
      translation('t_b1', b1.id),
      translation('t_b2', b2.id),
      translation('t_usr', usr.id),
    ]

    const cards = composeSessionPure(base({ entries, translations }))

    // No-SRS words only surface their recognition direction; production is gated (§6 1b).
    expect(cards.every((c) => c.skill === 'recognize')).toBe(true)
    // b2 contributes nothing
    expect(cards.some((c) => c.targetEntryId === b2.id)).toBe(false)
    // a1 → one practice (calibration) card, no review state
    const a1cards = cards.filter((c) => c.targetEntryId === a1.id)
    expect(a1cards).toHaveLength(1)
    expect(a1cards[0]?.mode).toBe('practice')
    expect(a1cards[0]?.reviewState).toBeUndefined()
    // b1 and usr → new cards
    expect(cards.filter((c) => c.targetEntryId === b1.id).every((c) => c.mode === 'new')).toBe(true)
    expect(cards.filter((c) => c.targetEntryId === usr.id).every((c) => c.mode === 'new')).toBe(true)

    expect(cards.filter((c) => c.mode === 'new')).toHaveLength(2)
    expect(cards.filter((c) => c.mode === 'practice')).toHaveLength(1)
  })

  it('includes a practice card only when its SRS state is due', () => {
    seq = 0
    const w = entry('word', 'seed', 'A1')
    const t = translation('t_w', w.id)
    const cards = composeSessionPure(
      base({
        entries: [w],
        translations: [t],
        reviewStates: [
          dueState('t_w', 'recognize', NOW - DAY), // due → in
          dueState('t_w', 'produce', NOW + DAY), // not yet due → out
        ],
      }),
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]?.skill).toBe('recognize')
    expect(cards[0]?.reviewState).toBeDefined()
  })

  it('respects the daily limits', () => {
    seq = 0
    const entries: Entry[] = []
    const translations: Translation[] = []
    for (let i = 0; i < 10; i++) {
      const e = entry(`new${i}`, 'seed', 'B1') // all new (level+1)
      entries.push(e)
      translations.push(translation(`t${i}`, e.id))
    }
    const cards = composeSessionPure(
      base({ entries, translations, limits: { newPerDay: 3, practicePerDay: 100 } }),
    )
    expect(cards.filter((c) => c.mode === 'new')).toHaveLength(3)
  })

  it('excludes hidden entries entirely', () => {
    seq = 0
    const w = entry('hidden', 'seed', 'A1', { hidden: true })
    const cards = composeSessionPure(
      base({ entries: [w], translations: [translation('t_h', w.id)] }),
    )
    expect(cards).toHaveLength(0)
  })

  it('interleaves new cards among practice cards, preserving counts', () => {
    seq = 0
    const entries: Entry[] = []
    const translations: Translation[] = []
    const reviewStates: ReviewState[] = []
    // 4 practice (A1, due) + 2 new (B1)
    for (let i = 0; i < 2; i++) {
      const p = entry(`p${i}`, 'seed', 'A1')
      entries.push(p)
      translations.push(translation(`tp${i}`, p.id))
      reviewStates.push(dueState(`tp${i}`, 'recognize', NOW - DAY))
      reviewStates.push(dueState(`tp${i}`, 'produce', NOW - DAY))
    }
    // two new words → one recognition card each (production gated)
    for (let i = 0; i < 2; i++) {
      const n = entry(`n${i}`, 'seed', 'B1')
      entries.push(n)
      translations.push(translation(`tn${i}`, n.id))
    }

    const cards = composeSessionPure(base({ entries, translations, reviewStates }))
    expect(cards.filter((c) => c.mode === 'practice')).toHaveLength(4)
    expect(cards.filter((c) => c.mode === 'new')).toHaveLength(2)
    expect(cards[0]?.mode).toBe('practice') // practice front-loaded
  })

  describe('daily new budget (§6.2)', () => {
    // 5 new-band (B1) words; `introduced` of them already have state created today.
    function setup(introduced: number) {
      seq = 0
      const entries: Entry[] = []
      const translations: Translation[] = []
      const reviewStates: ReviewState[] = []
      for (let i = 0; i < 5; i++) {
        const e = entry(`b1_${i}`, 'seed', 'B1')
        entries.push(e)
        translations.push(translation(`t${i}`, e.id))
        if (i < introduced) {
          // recognition introduced today, not yet due → counts against budget, no card
          reviewStates.push(srsState(`t${i}`, 'recognize', { createdAt: NOW, due: NOW + DAY }))
        }
      }
      return { entries, translations, reviewStates }
    }

    it('subtracts cards already introduced today from the budget', () => {
      const { entries, translations, reviewStates } = setup(2)
      const cards = composeSessionPure(
        base({ entries, translations, reviewStates, limits: { newPerDay: 3, practicePerDay: 100 } }),
      )
      expect(cards.filter((c) => c.mode === 'new')).toHaveLength(1) // 3 budget − 2 done
    })

    it('pushFurther ignores what was already introduced today', () => {
      const { entries, translations, reviewStates } = setup(2)
      const cards = composeSessionPure(
        base({
          entries,
          translations,
          reviewStates,
          limits: { newPerDay: 3, practicePerDay: 100 },
          pushFurther: true,
        }),
      )
      expect(cards.filter((c) => c.mode === 'new')).toHaveLength(3) // full fresh batch
    })

    it('does not count introductions from before today', () => {
      seq = 0
      const e = entry('b1', 'seed', 'B1')
      const other = entry('b1b', 'seed', 'B1')
      const cards = composeSessionPure(
        base({
          entries: [e, other],
          translations: [translation('t0', e.id), translation('t1', other.id)],
          // yesterday's introduction — should not eat into today's budget
          reviewStates: [srsState('t0', 'recognize', { createdAt: NOW - DAY, due: NOW + DAY })],
          limits: { newPerDay: 5, practicePerDay: 100 },
        }),
      )
      expect(cards.filter((c) => c.mode === 'new')).toHaveLength(1) // only the fresh word
    })
  })

  describe('calibration ordering (§6.3)', () => {
    function calibrationPool(n: number) {
      seq = 0
      const entries: Entry[] = []
      const translations: Translation[] = []
      for (let i = 0; i < n; i++) {
        const e = entry(`a1_${String(i).padStart(2, '0')}`, 'seed', 'A1') // A1 <= level A2 → calibration
        entries.push(e)
        translations.push(translation(`t${i}`, e.id))
      }
      return { entries, translations }
    }
    const order = (input: ComposerInput) => composeSessionPure(input).map((c) => c.targetEntryId)

    it('is stable within a day but varies across days', () => {
      const { entries, translations } = calibrationPool(20)
      const day1a = order(base({ entries, translations, dayStart: 1000 * DAY }))
      const day1b = order(base({ entries, translations, dayStart: 1000 * DAY }))
      const day2 = order(base({ entries, translations, dayStart: 1001 * DAY }))
      expect(day1a).toEqual(day1b) // deterministic per day
      expect(day1a).not.toEqual(day2) // different day → reshuffled
      expect([...day1a].sort()).toEqual([...day2].sort()) // same set, different order
    })

    it('keeps lower CEFR bands ahead of higher ones', () => {
      seq = 0
      const a1 = entry('zzz_a1', 'seed', 'A1') // alphabetically last, but lower band
      const a2 = entry('aaa_a2', 'seed', 'A2') // alphabetically first, but higher band
      const cards = composeSessionPure(
        base({
          entries: [a1, a2],
          translations: [translation('t_a1', a1.id), translation('t_a2', a2.id)],
        }),
      )
      const firstA1 = cards.findIndex((c) => c.targetEntryId === a1.id)
      const firstA2 = cards.findIndex((c) => c.targetEntryId === a2.id)
      expect(firstA1).toBeLessThan(firstA2)
    })
  })

  describe('production gating (§6 1b)', () => {
    it('withholds production until recognition has graduated and stabilised', () => {
      seq = 0
      const w = entry('word', 'seed', 'B1') // level+1 → progression
      const t = translation('t_w', w.id)
      // recognition graduated but not yet stable enough (< 7 days)
      const locked = composeSessionPure(
        base({
          entries: [w],
          translations: [t],
          reviewStates: [srsState('t_w', 'recognize', { state: 'review', stability: 3, due: NOW - DAY })],
        }),
      )
      expect(locked.map((c) => c.skill)).toEqual(['recognize'])
    })

    it('introduces production once recognition is graduated and stable', () => {
      seq = 0
      const w = entry('word', 'seed', 'B1')
      const t = translation('t_w', w.id)
      const unlocked = composeSessionPure(
        base({
          entries: [w],
          translations: [t],
          reviewStates: [srsState('t_w', 'recognize', { state: 'review', stability: 10, due: NOW - DAY })],
        }),
      )
      const produce = unlocked.find((c) => c.skill === 'produce')
      expect(produce).toBeDefined()
      expect(produce?.mode).toBe('new') // first production attempt, no state yet
    })

    it('keeps an existing production card independent even if recognition lapses', () => {
      seq = 0
      const w = entry('word', 'seed', 'B1')
      const t = translation('t_w', w.id)
      const cards = composeSessionPure(
        base({
          entries: [w],
          translations: [t],
          reviewStates: [
            srsState('t_w', 'recognize', { state: 'relearning', stability: 2, due: NOW - DAY }),
            srsState('t_w', 'produce', { state: 'review', stability: 15, due: NOW - DAY }),
          ],
        }),
      )
      expect(cards.find((c) => c.skill === 'produce')).toBeDefined()
    })
  })
})

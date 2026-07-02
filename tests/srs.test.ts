import { describe, expect, it } from 'vitest'
import { applyRating, createReviewState, isDue } from '../src/srs/fsrs-adapter'
import { composeSessionPure, gradeGroup, type ComposerInput } from '../src/srs/session-composer'
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
    study: 'auto',
    createdAt: 1000 + seq,
    updatedAt: 1000 + seq,
    ...extra,
  }
}

function translation(id: string, targetEntryId: string): Translation {
  return { id, targetEntryId, nativeEntryId: `n_${targetEntryId}`, meaningKey: 0, primary: true, source: 'seed', createdAt: 0 }
}

// A non-primary meaning of a multi-meaning word (production-only card). (multi-meaning design)
// A `senseKey` marks the promoted meaning as part of a partitioned concept, so it groups with the
// other Swedish words of that sense (§12 grouping follow-up).
function altTranslation(id: string, targetEntryId: string, meaningKey: number, senseKey?: string): Translation {
  return { id, targetEntryId, nativeEntryId: `n_${id}`, meaningKey, primary: false, source: 'seed', createdAt: 0, ...(senseKey ? { senseKey } : {}) }
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

  it('excludes skip ("never practiced") entries entirely', () => {
    seq = 0
    const w = entry('skipped', 'seed', 'A1', { study: 'skip' })
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

    function bandPool(cefr: Cefr, n: number, prefix: string) {
      const entries: Entry[] = []
      const translations: Translation[] = []
      for (let i = 0; i < n; i++) {
        const e = entry(`${prefix}_${String(i).padStart(2, '0')}`, 'seed', cefr)
        entries.push(e)
        translations.push(translation(`t_${prefix}_${i}`, e.id))
      }
      return { entries, translations }
    }

    it('favours the near-level band but keeps a thin tail of the lower one', () => {
      seq = 0
      const own = bandPool('A2', 60, 'a2') // user's own band (distance 0)
      const lower = bandPool('A1', 60, 'a1') // one step below (distance 1)
      const cefrById = new Map<string, Cefr>()
      for (const e of own.entries) cefrById.set(e.id, 'A2')
      for (const e of lower.entries) cefrById.set(e.id, 'A1')
      const cards = composeSessionPure(
        base({
          level: 'A2',
          limits: { newPerDay: 100, practicePerDay: 60 }, // cap bites: 60 of 120
          entries: [...own.entries, ...lower.entries],
          translations: [...own.translations, ...lower.translations],
        }),
      )
      const count = (c: Cefr) => cards.filter((x) => cefrById.get(x.targetEntryId) === c).length
      expect(count('A2')).toBeGreaterThan(count('A1')) // near-level dominates the session
      expect(count('A1')).toBeGreaterThan(0) // ...but the lower band is not starved
    })

    it('grades a multi-band backlog by proximity (B1 → B1 > A2 > A1)', () => {
      seq = 0
      const b1 = bandPool('B1', 60, 'b1') // distance 0
      const a2 = bandPool('A2', 60, 'a2') // distance 1
      const a1 = bandPool('A1', 60, 'a1') // distance 2
      const cefrById = new Map<string, Cefr>()
      for (const e of b1.entries) cefrById.set(e.id, 'B1')
      for (const e of a2.entries) cefrById.set(e.id, 'A2')
      for (const e of a1.entries) cefrById.set(e.id, 'A1')
      const cards = composeSessionPure(
        base({
          level: 'B1',
          limits: { newPerDay: 100, practicePerDay: 90 }, // 90 of 180
          entries: [...b1.entries, ...a2.entries, ...a1.entries],
          translations: [...b1.translations, ...a2.translations, ...a1.translations],
        }),
      )
      const count = (c: Cefr) => cards.filter((x) => cefrById.get(x.targetEntryId) === c).length
      expect(count('B1')).toBeGreaterThan(count('A2'))
      expect(count('A2')).toBeGreaterThan(count('A1'))
      expect(count('A1')).toBeGreaterThan(0) // tail still represented
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

    it('introduces production once recognition is graduated, stable, and not itself due', () => {
      seq = 0
      const w = entry('word', 'seed', 'B1')
      const t = translation('t_w', w.id)
      // Recognition graduated and next due in the future → a later, naturally-spaced session.
      const unlocked = composeSessionPure(
        base({
          entries: [w],
          translations: [t],
          reviewStates: [srsState('t_w', 'recognize', { state: 'review', stability: 10, due: NOW + DAY })],
        }),
      )
      const produce = unlocked.find((c) => c.skill === 'produce')
      expect(produce).toBeDefined()
      expect(produce?.mode).toBe('new') // first production attempt, no state yet
      expect(unlocked.some((c) => c.skill === 'recognize')).toBe(false) // recognition not due → not shown
    })

    it('defers first production while recognition is also due the same session', () => {
      seq = 0
      const w = entry('word', 'seed', 'B1')
      const t = translation('t_w', w.id)
      // Recognition is stabilised (production unlocked) AND due today — don't ask both
      // directions of the same word back-to-back; defer the reverse to a later session.
      const cards = composeSessionPure(
        base({
          entries: [w],
          translations: [t],
          reviewStates: [srsState('t_w', 'recognize', { state: 'review', stability: 10, due: NOW - DAY })],
        }),
      )
      expect(cards.map((c) => c.skill)).toEqual(['recognize'])
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

  describe('multi-meaning words (multi-meaning design)', () => {
    it('asks recognition once per word — only the primary meaning gets a recognize card', () => {
      seq = 0
      const w = entry('led', 'seed', 'B1') // progression at A2 → new cards
      const cards = composeSessionPure(
        base({
          entries: [w],
          translations: [translation('t_joint', w.id), altTranslation('t_route', w.id, 1)],
        }),
      )
      const recognize = cards.filter((c) => c.skill === 'recognize')
      expect(recognize).toHaveLength(1)
      expect(recognize[0]?.translationId).toBe('t_joint') // the primary meaning carries recognition
      // The extra meaning contributes no recognition card at all.
      expect(cards.some((c) => c.translationId === 't_route' && c.skill === 'recognize')).toBe(false)
    })

    it("unlocks EVERY meaning's production once the WORD's recognition stabilises", () => {
      seq = 0
      const w = entry('led', 'seed', 'B1')
      // The word's recognition (on the primary meaning) is graduated, stable, and not itself due.
      const cards = composeSessionPure(
        base({
          entries: [w],
          translations: [translation('t_joint', w.id), altTranslation('t_route', w.id, 1)],
          reviewStates: [srsState('t_joint', 'recognize', { state: 'review', stability: 10, due: NOW + DAY })],
        }),
      )
      const produce = cards.filter((c) => c.skill === 'produce')
      // Both the primary and the extra meaning surface production — the extra one gates behind the
      // WORD's recognition even though it has no recognition state of its own.
      expect(produce.map((c) => c.translationId).sort()).toEqual(['t_joint', 't_route'])
      expect(produce.every((c) => c.mode === 'new')).toBe(true)
      expect(cards.some((c) => c.skill === 'recognize')).toBe(false) // recognition not due → not shown
    })

    it("holds an extra meaning's production while the word's recognition is unstable", () => {
      seq = 0
      const w = entry('led', 'seed', 'B1')
      const cards = composeSessionPure(
        base({
          entries: [w],
          translations: [translation('t_joint', w.id), altTranslation('t_route', w.id, 1)],
          // Recognition graduated but not stable enough (< 7 days) → no production unlocks yet.
          reviewStates: [srsState('t_joint', 'recognize', { state: 'review', stability: 3, due: NOW - DAY })],
        }),
      )
      expect(cards.map((c) => c.skill)).toEqual(['recognize']) // only the word's recognition
      expect(cards.some((c) => c.skill === 'produce')).toBe(false)
    })
  })

  describe('multi-answer production groups (plan)', () => {
    const SENSE = { key: 'clearly#0', gloss: 'in a clear way' }

    // tydligt + klart, both the "in a clear way" sense of "clearly". Recognition is stabilised but
    // NOT due, so it stays out of the session; recognition stability is low enough (< unlock) that a
    // sibling without a produce state is never introduced here, keeping the produce assertions clean.
    function synonyms(produceStates: Record<string, Partial<ReviewState>>) {
      seq = 0
      const tyd = entry('tydligt', 'seed', 'A2', { sense: SENSE })
      const kla = entry('klart', 'seed', 'A2', { sense: SENSE })
      const reviewStates: ReviewState[] = [
        srsState('t_tyd', 'recognize', { state: 'review', stability: 3, due: NOW + DAY }),
        srsState('t_kla', 'recognize', { state: 'review', stability: 3, due: NOW + DAY }),
      ]
      for (const [tid, fields] of Object.entries(produceStates)) {
        reviewStates.push(srsState(tid, 'produce', { state: 'review', stability: 12, ...fields }))
      }
      return base({
        entries: [tyd, kla],
        translations: [translation('t_tyd', tyd.id), translation('t_kla', kla.id)],
        reviewStates,
      })
    }

    it('asks two taught synonyms of one sense as a single grouped card', () => {
      // tydligt due now, klart taught but due later → one card carrying both.
      const cards = composeSessionPure(synonyms({ t_tyd: { due: NOW - DAY }, t_kla: { due: NOW + 2 * DAY } }))
      const produce = cards.filter((c) => c.skill === 'produce')
      expect(produce).toHaveLength(1)
      expect(produce[0]?.group?.members.map((m) => m.translationId).sort()).toEqual(['t_kla', 't_tyd'])
      expect(produce[0]?.translationId).toBe('t_tyd') // earliest-due member represents the group
    })

    it('collapses to one card even when both synonyms are due', () => {
      const cards = composeSessionPure(synonyms({ t_tyd: { due: NOW - DAY }, t_kla: { due: NOW - 2 * DAY } }))
      const produce = cards.filter((c) => c.skill === 'produce')
      expect(produce).toHaveLength(1)
      expect(produce[0]?.group?.members).toHaveLength(2)
      expect(produce[0]?.translationId).toBe('t_kla') // klart is earliest-due → representative
    })

    it('pulls in a recognised sibling even before it has its own production state', () => {
      // klart has only been recognised (taught as a new word); tydligt's production is due → ask both.
      const cards = composeSessionPure(synonyms({ t_tyd: { due: NOW - DAY } }))
      const produce = cards.filter((c) => c.skill === 'produce')
      expect(produce).toHaveLength(1)
      expect(produce[0]?.group?.members.map((m) => m.translationId).sort()).toEqual(['t_kla', 't_tyd'])
      expect(produce[0]?.translationId).toBe('t_tyd') // tydligt has the due produce card; klart rides along
    })

    it('does not pull in a sibling the learner has never recognised or produced', () => {
      seq = 0
      const tyd = entry('tydligt', 'seed', 'A2', { sense: SENSE })
      const kla = entry('klart', 'seed', 'A2', { sense: SENSE })
      const cards = composeSessionPure(
        base({
          entries: [tyd, kla],
          translations: [translation('t_tyd', tyd.id), translation('t_kla', kla.id)],
          reviewStates: [
            srsState('t_tyd', 'recognize', { state: 'review', stability: 3, due: NOW + DAY }),
            srsState('t_tyd', 'produce', { state: 'review', stability: 12, due: NOW - DAY }),
            // klart: no state at all — never taught, so it must not appear as an answer
          ],
        }),
      )
      const produce = cards.filter((c) => c.skill === 'produce')
      expect(produce).toHaveLength(1)
      expect(produce[0]?.group).toBeUndefined() // only one introduced member → ordinary card
      expect(produce[0]?.translationId).toBe('t_tyd')
    })

    it('holds back a recognition-only sibling whose recognition is itself due this session', () => {
      seq = 0
      const tyd = entry('tydligt', 'seed', 'A2', { sense: SENSE })
      const kla = entry('klart', 'seed', 'A2', { sense: SENSE })
      const cards = composeSessionPure(
        base({
          entries: [tyd, kla],
          translations: [translation('t_tyd', tyd.id), translation('t_kla', kla.id)],
          reviewStates: [
            srsState('t_tyd', 'recognize', { state: 'review', stability: 3, due: NOW + DAY }),
            srsState('t_tyd', 'produce', { state: 'review', stability: 12, due: NOW - DAY }),
            // klart recognised only AND its recognition is due today → don't also ask its production
            srsState('t_kla', 'recognize', { state: 'review', stability: 3, due: NOW - DAY }),
          ],
        }),
      )
      const produce = cards.filter((c) => c.skill === 'produce')
      expect(produce).toHaveLength(1)
      expect(produce[0]?.group).toBeUndefined() // klart deferred → no group this session
      expect(cards.some((c) => c.skill === 'recognize' && c.translationId === 't_kla')).toBe(true)
    })

    it('does not group when there is no sense data', () => {
      seq = 0
      const a = entry('snabbt', 'seed', 'A2') // no sense
      const b = entry('fort', 'seed', 'A2') // no sense
      const cards = composeSessionPure(
        base({
          entries: [a, b],
          translations: [translation('t_a', a.id), translation('t_b', b.id)],
          reviewStates: [
            srsState('t_a', 'produce', { state: 'review', stability: 12, due: NOW - DAY }),
            srsState('t_b', 'produce', { state: 'review', stability: 12, due: NOW - DAY }),
          ],
        }),
      )
      const produce = cards.filter((c) => c.skill === 'produce')
      expect(produce).toHaveLength(2) // two ordinary cards, no grouping
      expect(produce.every((c) => c.group === undefined)).toBe(true)
    })
  })

  // A promoted meaning of one word shares a sense with the PRIMARY of another word (e.g. English
  // "husband" is make's primary + man's promoted meaning). The grouping key of a promoted meaning
  // lives on its link's `senseKey`; a primary's lives on its entry's `sense.key`. When they match, the
  // composer asks them together as one multi-answer card — exactly like a plain synonym group, but
  // spanning a primary and a promoted meaning of different words. (§12 grouping follow-up)
  describe('multi-answer groups spanning a promoted meaning (§12 grouping follow-up)', () => {
    it('groups a word\'s primary with another word\'s promoted meaning (husband → make + man)', () => {
      seq = 0
      // make → "husband, spouse" (primary of that sense); man → primary "man" + promoted "husband".
      const make = entry('make', 'seed', 'A2', { sense: { key: 'husband, spouse#0', gloss: '' } })
      const man = entry('man', 'seed', 'A2', { sense: { key: 'man#0', gloss: 'adult male' } })
      const cards = composeSessionPure(
        base({
          entries: [make, man],
          translations: [
            translation('t_make', make.id),
            translation('t_man', man.id),
            altTranslation('t_man_husband', man.id, 1, 'husband, spouse#0'),
          ],
          reviewStates: [
            // Words recognised + stabilised but not due (so no recognition card, no fresh unlock).
            srsState('t_make', 'recognize', { state: 'review', stability: 3, due: NOW + DAY }),
            srsState('t_man', 'recognize', { state: 'review', stability: 3, due: NOW + DAY }),
            // make's husband production is due; man's husband production is taught but due later.
            srsState('t_make', 'produce', { state: 'review', stability: 12, due: NOW - DAY }),
            srsState('t_man_husband', 'produce', { state: 'review', stability: 12, due: NOW + 2 * DAY }),
          ],
        }),
      )
      const produce = cards.filter((c) => c.skill === 'produce')
      expect(produce).toHaveLength(1) // one grouped card (man's plain "man" production isn't unlocked)
      expect(produce[0]?.group?.members.map((m) => m.translationId).sort()).toEqual(['t_make', 't_man_husband'])
      expect(produce[0]?.translationId).toBe('t_make') // earliest-due member (a primary) represents the group
    })

    it('groups same-sense answers but keeps a distinct sense separate (right: entitlement vs direction)', () => {
      seq = 0
      // rätt (noun): primary "dish" + promoted "right, entitlement". rättighet: primary "right"
      // (entitlement). höger: primary "right" (the direction) — a DIFFERENT sense of the same phrase.
      const rattighet = entry('rättighet', 'seed', 'A2', { sense: { key: 'right, correct#1', gloss: 'an entitlement' } })
      const ratt = entry('rätt', 'seed', 'A2', { sense: { key: 'dish#0', gloss: '' } })
      const hoger = entry('höger', 'seed', 'A2', { sense: { key: 'right, correct#3', gloss: 'right-hand side' } })
      const cards = composeSessionPure(
        base({
          entries: [rattighet, ratt, hoger],
          translations: [
            translation('t_rattighet', rattighet.id),
            translation('t_ratt', ratt.id),
            altTranslation('t_ratt_ent', ratt.id, 1, 'right, correct#1'),
            translation('t_hoger', hoger.id),
          ],
          reviewStates: [
            srsState('t_rattighet', 'recognize', { state: 'review', stability: 3, due: NOW + DAY }),
            srsState('t_ratt', 'recognize', { state: 'review', stability: 3, due: NOW + DAY }),
            srsState('t_hoger', 'recognize', { state: 'review', stability: 3, due: NOW + DAY }),
            // entitlement group (rättighet + rätt's promoted meaning) both due; höger (direction) due too.
            srsState('t_rattighet', 'produce', { state: 'review', stability: 12, due: NOW - DAY }),
            srsState('t_ratt_ent', 'produce', { state: 'review', stability: 12, due: NOW - DAY }),
            srsState('t_hoger', 'produce', { state: 'review', stability: 12, due: NOW - DAY }),
          ],
        }),
      )
      const produce = cards.filter((c) => c.skill === 'produce')
      expect(produce).toHaveLength(2) // the entitlement GROUP + höger as its own card
      const group = produce.find((c) => c.group)
      expect(group?.group?.members.map((m) => m.translationId).sort()).toEqual(['t_ratt_ent', 't_rattighet'])
      // höger is the "direction" sense (different key) → a solo card, never pulled into the entitlement group.
      const solo = produce.find((c) => !c.group)
      expect(solo?.translationId).toBe('t_hoger')
      expect(group?.group?.members.some((m) => m.translationId === 't_hoger')).toBe(false)
    })
  })
})

describe('gradeGroup (multi-answer grading)', () => {
  // A realistic, FSRS-valid produce state: introduced then reviewed to maturity, so it's a 'review'
  // card with valid difficulty/stability. (Hand-crafting {state:'review'} with difficulty 0 — fine for
  // the composer, which does no FSRS math — is rejected by the scheduler the moment applyRating runs.)
  const matured = (translationId: string) => {
    let rs = createReviewState(translationId, 'produce', NOW - 40 * DAY)
    for (const at of [NOW - 40 * DAY, NOW - 25 * DAY, NOW - 10 * DAY]) rs = applyRating(rs, 'good', at)
    return { translationId, reviewState: rs }
  }

  it('grades each member with its own label', () => {
    const [a, b] = gradeGroup([{ ...matured('t_a'), label: 'good' }, { ...matured('t_b'), label: 'again' }], NOW)
    expect(a.due).toBeGreaterThan(NOW) // good → pushed out
    expect(b.due).toBeLessThan(a.due) // again → comes back sooner
    expect(b.lapses).toBe(1) // "again" on a review card is a lapse
    expect(a.lapses).toBe(0) // the recalled one didn't lapse
  })

  it('advances every member when all are Good (the "Knew all" case)', () => {
    const rows = gradeGroup([{ ...matured('t_a'), label: 'good' }, { ...matured('t_b'), label: 'good' }], NOW)
    expect(rows.every((r) => r.due > NOW)).toBe(true)
    expect(rows.every((r) => r.lapses === 0)).toBe(true)
  })

  it('creates fresh produce state for a member that has none', () => {
    const [n] = gradeGroup([{ translationId: 't_new', label: 'good' }], NOW)
    expect(n.translationId).toBe('t_new')
    expect(n.skill).toBe('produce')
    expect(n.reps).toBe(1)
  })
})

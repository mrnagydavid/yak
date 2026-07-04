import { describe, expect, it } from 'vitest'
import { clearedNextLevel, levelBreakdown, promotionSnoozed } from '../src/srs/level-progress'
import { LEVELS_BY_RANK, nextLevel } from '../src/srs/levels'
import type { Cefr, Entry, ReviewState, ReviewStateName, Skill, Source, StudyPref, Translation } from '../src/db/types'

// ---- fixtures ----

function entry(id: string, cefr: Cefr | undefined, source: Source, study: StudyPref): Entry {
  return {
    id,
    lang: 'sv',
    lemma: id,
    pos: 'noun',
    features: {},
    inflections: {},
    pronunciation: {},
    source,
    cefr,
    study,
    createdAt: 0,
    updatedAt: 0,
  }
}

function translation(id: string, targetEntryId: string): Translation {
  return { id, targetEntryId, nativeEntryId: `n_${id}`, meaningKey: 0, primary: true, source: 'seed', createdAt: 0 }
}

function state(translationId: string, skill: Skill, s: ReviewStateName, over: Partial<ReviewState> = {}): ReviewState {
  return {
    id: `rs_${translationId}_${skill}`,
    translationId,
    skill,
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
    ...over,
  }
}

interface Spec {
  cefr?: Cefr
  rec?: ReviewStateName // recognition state; omit = never started (no row)
  recStability?: number // recognition stability (days) — drives deriveStatus buckets
  recLapses?: number // recognition lapse count — drives the "struggling" bucket
  produce?: ReviewStateName // production state; independent of both trigger and breakdown
  study?: StudyPref
  source?: Source
}

function build(specs: Spec[]): { entries: Entry[]; translations: Translation[]; reviewStates: ReviewState[] } {
  const entries: Entry[] = []
  const translations: Translation[] = []
  const reviewStates: ReviewState[] = []
  specs.forEach((s, i) => {
    const eid = `e${i}`
    const tid = `t${i}`
    entries.push(entry(eid, s.cefr, s.source ?? 'seed', s.study ?? 'auto'))
    translations.push(translation(tid, eid))
    if (s.rec) reviewStates.push(state(tid, 'recognize', s.rec, { stability: s.recStability ?? 0, lapses: s.recLapses ?? 0 }))
    if (s.produce) reviewStates.push(state(tid, 'produce', s.produce))
  })
  return { entries, translations, reviewStates }
}

// ---- nextLevel ----

describe('nextLevel', () => {
  it('steps up through the ladder', () => {
    expect(nextLevel('below-A1')).toBe('A1')
    expect(nextLevel('A1')).toBe('A2')
    expect(nextLevel('B1')).toBe('B2')
    expect(nextLevel('C1')).toBe('C2')
  })

  it('returns null at the ceiling', () => {
    expect(nextLevel('C2')).toBeNull()
  })

  it('LEVELS_BY_RANK index equals levelRank', () => {
    expect(LEVELS_BY_RANK[3]).toBe('B1')
    expect(LEVELS_BY_RANK[4]).toBe('B2')
  })
})

// ---- clearedNextLevel ----

describe('clearedNextLevel — B1 clearing the B2 band', () => {
  it('promotes when every B2 word has recognition in review', () => {
    const data = build([
      { cefr: 'B2', rec: 'review' },
      { cefr: 'B2', rec: 'review' },
    ])
    expect(clearedNextLevel({ level: 'B1', ...data })).toBe('B2')
  })

  it('does NOT promote while a B2 word is still only in learning', () => {
    const data = build([
      { cefr: 'B2', rec: 'review' },
      { cefr: 'B2', rec: 'learning' },
    ])
    expect(clearedNextLevel({ level: 'B1', ...data })).toBeNull()
  })

  it('does NOT promote while a B2 word is relearning (having trouble)', () => {
    const data = build([
      { cefr: 'B2', rec: 'review' },
      { cefr: 'B2', rec: 'relearning' },
    ])
    expect(clearedNextLevel({ level: 'B1', ...data })).toBeNull()
  })

  it('does NOT promote while a B2 word was never started (no recognition row)', () => {
    const data = build([{ cefr: 'B2', rec: 'review' }, { cefr: 'B2' /* unstarted */ }])
    expect(clearedNextLevel({ level: 'B1', ...data })).toBeNull()
  })

  it('ignores a study:skip word — cleared even if that word is unlearned', () => {
    const data = build([
      { cefr: 'B2', rec: 'review' },
      { cefr: 'B2', study: 'skip' /* excluded, never started */ },
    ])
    expect(clearedNextLevel({ level: 'B1', ...data })).toBe('B2')
  })

  it('ignores words below the band (calibration) and above it (level+2)', () => {
    const data = build([
      { cefr: 'B1' /* at level — not required */ },
      { cefr: 'A2' /* below — not required */ },
      { cefr: 'C1' /* level+2 — not required */ },
      { cefr: 'B2', rec: 'review' },
    ])
    expect(clearedNextLevel({ level: 'B1', ...data })).toBe('B2')
  })

  it('ignores user entries (no cefr) — they never block promotion', () => {
    const data = build([
      { cefr: 'B2', rec: 'review' },
      { source: 'user' /* user word, no state */ },
    ])
    expect(clearedNextLevel({ level: 'B1', ...data })).toBe('B2')
  })

  it('keys off recognition only — production state is irrelevant', () => {
    // Recognition graduated, production still learning → cleared.
    const graduated = build([{ cefr: 'B2', rec: 'review', produce: 'learning' }])
    expect(clearedNextLevel({ level: 'B1', ...graduated })).toBe('B2')

    // Production graduated but recognition missing → NOT cleared.
    const prodOnly = build([{ cefr: 'B2', produce: 'review' }])
    expect(clearedNextLevel({ level: 'B1', ...prodOnly })).toBeNull()
  })

  it('returns null when the band above is empty (no seed words there)', () => {
    const data = build([{ cefr: 'B1', rec: 'review' }]) // only at-level words
    expect(clearedNextLevel({ level: 'B1', ...data })).toBeNull()
  })
})

describe('clearedNextLevel — edges of the ladder', () => {
  it('promotes below-A1 → A1 when the A1 band is cleared', () => {
    const data = build([{ cefr: 'A1', rec: 'review' }])
    expect(clearedNextLevel({ level: 'below-A1', ...data })).toBe('A1')
  })

  it('never promotes past C2 (no band above the ceiling)', () => {
    const data = build([{ cefr: 'C2', rec: 'review' }])
    expect(clearedNextLevel({ level: 'C2', ...data })).toBeNull()
  })
})

// ---- levelBreakdown ----

/** Find one CEFR row in a breakdown result. */
function row(rows: ReturnType<typeof levelBreakdown>, level: Cefr) {
  return rows.find((r) => r.level === level)!
}

describe('levelBreakdown', () => {
  it('returns a row for every CEFR level A1–C2', () => {
    const rows = levelBreakdown(build([]))
    expect(rows.map((r) => r.level)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
    expect(rows.every((r) => r.total === 0)).toBe(true)
  })

  it('classifies recognition status with the same thresholds as Vocabulary', () => {
    const rows = levelBreakdown(
      build([
        { cefr: 'B1', rec: 'review', recStability: 50 }, // >= 30 → solid
        { cefr: 'B1', rec: 'review', recStability: 10 }, // < 30 → learning
        { cefr: 'B1', rec: 'relearning', recStability: 5, recLapses: 4 }, // lapses>=3 && <7 → struggling
        { cefr: 'B1' }, // no recognition row → none
      ]),
    )
    const b1 = row(rows, 'B1')
    expect(b1.counts).toEqual({ solid: 1, learning: 1, struggling: 1, none: 1 })
    expect(b1.total).toBe(4)
  })

  it('a low-stability word with few lapses is learning, not struggling', () => {
    const rows = levelBreakdown(build([{ cefr: 'A2', rec: 'review', recStability: 5, recLapses: 1 }]))
    expect(row(rows, 'A2').counts).toEqual({ solid: 0, learning: 1, struggling: 0, none: 0 })
  })

  it('groups words under their own CEFR level', () => {
    const rows = levelBreakdown(
      build([
        { cefr: 'A1', rec: 'review', recStability: 50 },
        { cefr: 'C2', rec: 'review', recStability: 50 },
      ]),
    )
    expect(row(rows, 'A1').counts.solid).toBe(1)
    expect(row(rows, 'C2').counts.solid).toBe(1)
    expect(row(rows, 'B1').total).toBe(0)
  })

  it('excludes skip words and user words (no CEFR)', () => {
    const rows = levelBreakdown(
      build([
        { cefr: 'B2', rec: 'review', recStability: 50 },
        { cefr: 'B2', study: 'skip', rec: 'review', recStability: 50 }, // excluded
        { source: 'user', rec: 'review', recStability: 50 }, // no cefr → excluded
      ]),
    )
    expect(row(rows, 'B2').total).toBe(1)
    expect(row(rows, 'B2').counts.solid).toBe(1)
  })

  it('counts sum to the level total', () => {
    const rows = levelBreakdown(
      build([
        { cefr: 'B1', rec: 'review', recStability: 50 },
        { cefr: 'B1', rec: 'learning', recStability: 2 },
        { cefr: 'B1' },
      ]),
    )
    const b1 = row(rows, 'B1')
    expect(b1.counts.solid + b1.counts.learning + b1.counts.struggling + b1.counts.none).toBe(b1.total)
  })
})

// ---- promotionSnoozed ----

describe('promotionSnoozed', () => {
  it('suppresses the same target on the same day', () => {
    expect(promotionSnoozed({ level: 'B2', day: 'Mon' }, 'B2', 'Mon')).toBe(true)
  })

  it('re-asks on a different day', () => {
    expect(promotionSnoozed({ level: 'B2', day: 'Mon' }, 'B2', 'Tue')).toBe(false)
  })

  it('does not suppress a different target level', () => {
    expect(promotionSnoozed({ level: 'B2', day: 'Mon' }, 'C1', 'Mon')).toBe(false)
  })

  it('is not snoozed when there is no record', () => {
    expect(promotionSnoozed(null, 'B2', 'Mon')).toBe(false)
  })
})

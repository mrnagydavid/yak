import { describe, expect, it } from 'vitest'
import { genderAnswer, isGenderEligible } from '../src/lang/sv/drills/gender'
import type { Entry } from '../src/db/types'

function noun(over: Partial<Entry> = {}): Entry {
  return {
    id: 'x',
    lang: 'sv',
    lemma: 'hund',
    pos: 'noun',
    features: { gender: 'en' },
    inflections: {},
    pronunciation: {},
    source: 'seed',
    study: 'auto',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe('gender eligibility', () => {
  it('includes a met noun that has a gender', () => {
    expect(isGenderEligible(noun(), true)).toBe(true)
    expect(isGenderEligible(noun({ features: { gender: 'ett' } }), true)).toBe(true)
  })

  it('excludes a noun the learner has not met yet', () => {
    expect(isGenderEligible(noun(), false)).toBe(false)
  })

  it('excludes a noun with no gender recorded', () => {
    expect(isGenderEligible(noun({ features: {} }), true)).toBe(false)
  })

  it('excludes non-nouns even if they somehow carry a gender feature', () => {
    expect(isGenderEligible(noun({ pos: 'verb' }), true)).toBe(false)
  })

  it('excludes manually skipped words', () => {
    expect(isGenderEligible(noun({ study: 'skip' }), true)).toBe(false)
  })
})

describe('gender answer', () => {
  it('reads the article, or null when absent', () => {
    expect(genderAnswer(noun())).toBe('en')
    expect(genderAnswer(noun({ features: { gender: 'ett' } }))).toBe('ett')
    expect(genderAnswer(noun({ features: {} }))).toBeNull()
  })
})

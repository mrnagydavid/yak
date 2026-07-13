import { describe, expect, it } from 'vitest'
import type { Entry } from '../src/db/types'
import { checkAnswer, isNounPluralEligible, normalizeAnswer } from '../src/lang/sv/drills/nounPlural'

function noun(lemma: string, infl: Record<string, string>, over: Partial<Entry> = {}): Entry {
  return {
    id: `id_${lemma}`,
    lang: 'sv',
    lemma,
    pos: 'noun',
    features: { gender: 'en' },
    inflections: infl,
    pronunciation: {},
    source: 'seed',
    study: 'auto',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

const bil = noun('bil', { definiteSingular: 'bilen', indefinitePlural: 'bilar', definitePlural: 'bilarna' })
const hus = noun('hus', { definiteSingular: 'huset', indefinitePlural: 'hus', definitePlural: 'husen' }, { features: { gender: 'ett' } })

describe('isNounPluralEligible', () => {
  it('includes a met countable noun with a plural (even an unchanged one)', () => {
    expect(isNounPluralEligible(bil, true)).toBe(true)
    expect(isNounPluralEligible(hus, true)).toBe(true)
  })

  it('excludes unmet, skipped, proper, uncountable, non-nouns, and missing plurals', () => {
    expect(isNounPluralEligible(bil, false)).toBe(false)
    expect(isNounPluralEligible(noun('bil', bil.inflections, { study: 'skip' }), true)).toBe(false)
    expect(isNounPluralEligible(noun('maj', {}, { features: { proper: 'yes' } }), true)).toBe(false)
    expect(isNounPluralEligible(noun('vatten', { indefinitePlural: 'vatten' }, { features: { countable: 'no' } }), true)).toBe(false)
    expect(isNounPluralEligible(noun('snabb', {}, { pos: 'adj' }), true)).toBe(false)
    expect(isNounPluralEligible(noun('x', { indefinitePlural: '-' }), true)).toBe(false)
    expect(isNounPluralEligible(noun('y', {}), true)).toBe(false)
  })
})

describe('normalizeAnswer', () => {
  it('trims and lowercases', () => {
    expect(normalizeAnswer('  Bilar ')).toBe('bilar')
    expect(normalizeAnswer('HUS')).toBe('hus')
  })
})

describe('checkAnswer', () => {
  it('accepts the indefinite plural, rejects the singular', () => {
    expect(checkAnswer(bil, 'bilar')).toBe(true)
    expect(checkAnswer(bil, ' Bilar ')).toBe(true)
    expect(checkAnswer(hus, 'hus')).toBe(true) // unchanged plural
    expect(checkAnswer(bil, 'bil')).toBe(false)
    expect(checkAnswer(bil, '')).toBe(false)
  })
})

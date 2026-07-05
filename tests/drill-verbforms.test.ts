import { describe, expect, it } from 'vitest'
import type { Entry } from '../src/db/types'
import {
  buildFormIndex,
  checkAnswer,
  decodeAccepts,
  isAmbiguousForm,
  isRegularVerb,
  isVerbFormsEligible,
  normalizeAnswer,
  pickMode,
  promptFor,
} from '../src/lang/sv/drills/verbForms'

function verb(lemma: string, infl: Record<string, string>, over: Partial<Entry> = {}): Entry {
  return {
    id: `id_${lemma}`,
    lang: 'sv',
    lemma,
    pos: 'verb',
    features: {},
    inflections: infl,
    pronunciation: {},
    source: 'seed',
    study: 'auto',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

const lägga = verb('lägga', { presens: 'lägger', preteritum: 'lade', supinum: 'lagt', imperativ: 'lägg' })
const tala = verb('tala', { presens: 'talar', preteritum: 'talade', supinum: 'talat', imperativ: 'tala' })

describe('isRegularVerb', () => {
  it('flags weak -a verbs whose forms follow the pattern (tala → talade → talat)', () => {
    expect(isRegularVerb(tala)).toBe(true)
  })

  it('treats strong / irregular verbs as irregular', () => {
    expect(isRegularVerb(lägga)).toBe(false) // lade/lagt, not lägg-ade/lägg-at
    expect(isRegularVerb(verb('göra', { preteritum: 'gjorde', supinum: 'gjort' }))).toBe(false)
    expect(isRegularVerb(verb('ha', { preteritum: 'hade', supinum: 'haft' }))).toBe(false) // sup breaks pattern
    expect(isRegularVerb(verb('bo', { preteritum: 'bodde', supinum: 'bott' }))).toBe(false) // short group-3
  })
})

describe('isVerbFormsEligible', () => {
  it('includes a met irregular verb with both forms', () => {
    expect(isVerbFormsEligible(lägga, true)).toBe(true)
  })

  it('excludes unmet, skipped, regular, and non-verbs', () => {
    expect(isVerbFormsEligible(lägga, false)).toBe(false)
    expect(isVerbFormsEligible(verb('lägga', lägga.inflections, { study: 'skip' }), true)).toBe(false)
    expect(isVerbFormsEligible(tala, true)).toBe(false) // regular
    expect(isVerbFormsEligible(verb('hund', {}, { pos: 'noun' }), true)).toBe(false)
  })

  it('excludes a verb missing a form or marked "-"', () => {
    expect(isVerbFormsEligible(verb('x', { preteritum: 'xde', supinum: '-' }), true)).toBe(false)
    expect(isVerbFormsEligible(verb('y', { preteritum: 'yde' }), true)).toBe(false)
  })
})

describe('pickMode', () => {
  it('is stable within a session (same entry + startedAt)', () => {
    expect(pickMode('id_lägga', 1000)).toBe(pickMode('id_lägga', 1000))
  })

  it('varies across sessions', () => {
    const modes = new Set(Array.from({ length: 60 }, (_, i) => pickMode('id_lägga', i)))
    expect(modes.size).toBeGreaterThan(1)
  })
})

describe('promptFor', () => {
  it('names the target: decode asks for the infinitive', () => {
    expect(promptFor('decode-pret')).toMatchObject({ decode: true, targetName: 'infinitive' })
  })

  it('names the target: produce asks for the specific form (supine glossed as the har-form)', () => {
    expect(promptFor('produce-sup')).toMatchObject({ decode: false, targetName: 'supine (har-form)' })
    expect(promptFor('produce-pret')).toMatchObject({ decode: false, targetName: 'past tense' })
  })
})

describe('form index (ambiguity + decode acceptance)', () => {
  const index = buildFormIndex([
    verb('le', { preteritum: 'log', supinum: 'lett' }),
    verb('leda', { preteritum: 'ledde', supinum: 'lett' }), // shares the supine 'lett' with le
    verb('lägga', { preteritum: 'lade', supinum: 'lagt' }),
  ])

  it('flags a surface form shared by more than one verb as ambiguous', () => {
    expect(isAmbiguousForm(index, 'lett')).toBe(true) // le + leda
    expect(isAmbiguousForm(index, 'lade')).toBe(false) // only lägga
    expect(isAmbiguousForm(index, 'log')).toBe(false)
  })

  it('accepts any infinitive that yields the shown surface form', () => {
    expect(decodeAccepts(index, 'lett', 'le')).toBe(true)
    expect(decodeAccepts(index, 'lett', 'leda')).toBe(true)
    expect(decodeAccepts(index, 'lett', 'lägga')).toBe(false)
    expect(decodeAccepts(index, 'lade', 'att lägga')).toBe(true) // normalizes the "att" prefix
  })
})

describe('normalizeAnswer', () => {
  it('trims, lowercases, and strips a leading "att"', () => {
    expect(normalizeAnswer('  Lägga ')).toBe('lägga')
    expect(normalizeAnswer('att lägga')).toBe('lägga')
    expect(normalizeAnswer('ATT LADE')).toBe('lade')
  })
})

describe('checkAnswer', () => {
  it('decode accepts the infinitive (with or without "att"), rejects a wrong verb', () => {
    expect(checkAnswer('decode-pret', lägga, 'lägga')).toBe(true)
    expect(checkAnswer('decode-sup', lägga, 'att lägga')).toBe(true)
    expect(checkAnswer('decode-pret', lägga, 'ligga')).toBe(false)
  })

  it('produce accepts the stored form and known variants, rejects the wrong slot', () => {
    expect(checkAnswer('produce-pret', lägga, 'lade')).toBe(true)
    expect(checkAnswer('produce-pret', lägga, 'la')).toBe(true) // colloquial variant
    expect(checkAnswer('produce-sup', lägga, 'lagt')).toBe(true)
    expect(checkAnswer('produce-pret', lägga, 'lagt')).toBe(false) // that's the supine, not the past
    expect(checkAnswer('produce-pret', lägga, '')).toBe(false)
  })
})

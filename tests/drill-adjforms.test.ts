import { describe, expect, it } from 'vitest'
import type { Entry } from '../src/db/types'
import {
  buildFormIndex,
  checkAnswer,
  decodeAccepts,
  isAdjFormsEligible,
  isAmbiguousForm,
  isPeriphrastic,
  isRegularAdjective,
  normalizeAnswer,
  pickMode,
  promptFor,
} from '../src/lang/sv/drills/adjForms'

function adj(lemma: string, infl: Record<string, string>, over: Partial<Entry> = {}): Entry {
  return {
    id: `id_${lemma}`,
    lang: 'sv',
    lemma,
    pos: 'adj',
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

const stor = adj('stor', { neutrum: 'stort', plural: 'stora', komparativ: 'större', superlativ: 'störst' })
const bra = adj('bra', { komparativ: 'bättre', superlativ: 'bäst' })
const ny = adj('ny', { neutrum: 'nytt', plural: 'nya', komparativ: 'nyare', superlativ: 'nyast' })

describe('isRegularAdjective', () => {
  it('flags -are/-ast words (ny → nyare/nyast)', () => {
    expect(isRegularAdjective(ny)).toBe(true)
    expect(isRegularAdjective(adj('enkel', { komparativ: 'enklare', superlativ: 'enklast' }))).toBe(true) // -el contraction
    expect(isRegularAdjective(adj('ringa', { komparativ: 'ringare', superlativ: 'ringast' }))).toBe(true) // dropped -a
    expect(isRegularAdjective(adj('ensam', { komparativ: 'ensammare', superlativ: 'ensammast' }))).toBe(true) // doubling
  })

  it('treats suppletive / vowel-shift adjectives as irregular', () => {
    expect(isRegularAdjective(stor)).toBe(false) // större/störst
    expect(isRegularAdjective(bra)).toBe(false) // bättre/bäst
    expect(isRegularAdjective(adj('gammal', { komparativ: 'äldre', superlativ: 'äldst' }))).toBe(false)
    expect(isRegularAdjective(adj('hög', { komparativ: 'högre', superlativ: 'högst' }))).toBe(false)
  })
})

describe('isPeriphrastic', () => {
  it('flags mer/mest comparison (mer politisk / mest politisk)', () => {
    expect(isPeriphrastic(adj('politisk', { komparativ: 'mer politisk', superlativ: 'mest politisk' }))).toBe(true)
  })

  it('is false for inflecting adjectives', () => {
    expect(isPeriphrastic(stor)).toBe(false)
  })
})

describe('isAdjFormsEligible', () => {
  it('includes a met irregular adjective with both forms', () => {
    expect(isAdjFormsEligible(stor, true)).toBe(true)
    expect(isAdjFormsEligible(bra, true)).toBe(true)
  })

  it('excludes unmet, skipped, regular, periphrastic, and non-adjectives', () => {
    expect(isAdjFormsEligible(stor, false)).toBe(false)
    expect(isAdjFormsEligible(adj('stor', stor.inflections, { study: 'skip' }), true)).toBe(false)
    expect(isAdjFormsEligible(ny, true)).toBe(false) // regular
    expect(isAdjFormsEligible(adj('politisk', { komparativ: 'mer politisk', superlativ: 'mest politisk' }), true)).toBe(false)
    expect(isAdjFormsEligible(adj('hund', {}, { pos: 'noun' }), true)).toBe(false)
  })

  it('excludes an adjective missing a form or marked "-"', () => {
    expect(isAdjFormsEligible(adj('x', { komparativ: 'större', superlativ: '-' }), true)).toBe(false)
    expect(isAdjFormsEligible(adj('y', { komparativ: 'större' }), true)).toBe(false)
  })
})

describe('pickMode', () => {
  it('is stable within a session (same entry + startedAt)', () => {
    expect(pickMode('id_stor', 1000)).toBe(pickMode('id_stor', 1000))
  })

  it('varies across sessions', () => {
    const modes = new Set(Array.from({ length: 60 }, (_, i) => pickMode('id_stor', i)))
    expect(modes.size).toBeGreaterThan(1)
  })
})

describe('promptFor', () => {
  it('decode asks for the base form', () => {
    expect(promptFor('decode-comp')).toMatchObject({ decode: true, targetName: 'base form' })
    expect(promptFor('decode-sup')).toMatchObject({ decode: true, targetName: 'base form' })
  })

  it('produce asks for the specific degree', () => {
    expect(promptFor('produce-comp')).toMatchObject({ decode: false, targetName: 'comparative' })
    expect(promptFor('produce-sup')).toMatchObject({ decode: false, targetName: 'superlative' })
  })
})

describe('form index (ambiguity + decode acceptance)', () => {
  const index = buildFormIndex([
    adj('liten', { komparativ: 'mindre', superlativ: 'minst' }),
    adj('få', { komparativ: 'färre', superlativ: 'minst' }), // shares the superlative 'minst' with liten
    stor,
    adj('politisk', { komparativ: 'mer politisk', superlativ: 'mest politisk' }), // periphrastic — excluded
  ])

  it('flags a surface form shared by more than one adjective as ambiguous', () => {
    expect(isAmbiguousForm(index, 'minst')).toBe(true) // liten + få
    expect(isAmbiguousForm(index, 'större')).toBe(false) // only stor
    expect(isAmbiguousForm(index, 'mindre')).toBe(false)
  })

  it('does not index periphrastic forms', () => {
    expect(index.has('mer politisk')).toBe(false)
    expect(index.has('mest politisk')).toBe(false)
  })

  it('accepts any base form that yields the shown surface form', () => {
    expect(decodeAccepts(index, 'minst', 'liten')).toBe(true)
    expect(decodeAccepts(index, 'minst', 'få')).toBe(true)
    expect(decodeAccepts(index, 'minst', 'stor')).toBe(false)
  })
})

describe('normalizeAnswer', () => {
  it('trims and lowercases', () => {
    expect(normalizeAnswer('  Större ')).toBe('större')
    expect(normalizeAnswer('BÄST')).toBe('bäst')
  })
})

describe('checkAnswer', () => {
  it('decode accepts the base form, rejects a wrong word', () => {
    expect(checkAnswer('decode-comp', stor, 'stor')).toBe(true)
    expect(checkAnswer('decode-sup', stor, 'Stor')).toBe(true)
    expect(checkAnswer('decode-comp', stor, 'liten')).toBe(false)
  })

  it('produce accepts the stored form and known variants, rejects the wrong degree', () => {
    expect(checkAnswer('produce-comp', stor, 'större')).toBe(true)
    expect(checkAnswer('produce-sup', stor, 'störst')).toBe(true)
    expect(checkAnswer('produce-comp', stor, 'störst')).toBe(false) // that's the superlative
    expect(checkAnswer('produce-comp', stor, '')).toBe(false)
    const nara = adj('nära', { komparativ: 'närmare', superlativ: 'närmast' })
    expect(checkAnswer('produce-comp', nara, 'närmre')).toBe(true) // parallel variant
  })
})

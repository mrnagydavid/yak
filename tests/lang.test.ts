import { describe, expect, it } from 'vitest'
import { getRenderer, wiktionaryUrl } from '../src/lang'
import { infinitivizeVerbIpa } from '../src/lang/sv/ipa'
import type { Entry, PartOfSpeech } from '../src/db/types'

describe('wiktionaryUrl', () => {
  it('links to the English Wiktionary page, jumped to the language section', () => {
    expect(wiktionaryUrl('hund', 'sv')).toBe('https://en.wiktionary.org/wiki/hund#Swedish')
  })

  it('encodes special characters in the lemma', () => {
    expect(wiktionaryUrl('gå på', 'sv')).toBe('https://en.wiktionary.org/wiki/g%C3%A5%20p%C3%A5#Swedish')
  })
})

function entry(overrides: Partial<Entry> & { lemma: string; pos: PartOfSpeech }): Entry {
  return {
    id: 'e',
    lang: 'sv',
    features: {},
    inflections: {},
    pronunciation: {},
    source: 'seed',
    study: 'auto',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('svRenderer', () => {
  const sv = getRenderer('sv')

  it('renders verbs with "att" and nouns with their gender article', () => {
    expect(sv.renderLemma(entry({ lemma: 'springa', pos: 'verb' }))).toBe('att springa')
    expect(sv.renderLemma(entry({ lemma: 'hund', pos: 'noun', features: { gender: 'en' } }))).toBe('en hund')
    expect(sv.renderLemma(entry({ lemma: 'hus', pos: 'noun', features: { gender: 'ett' } }))).toBe('ett hus')
    expect(sv.renderLemma(entry({ lemma: 'snabb', pos: 'adj' }))).toBe('snabb')
  })

  it('orders verb principal parts and capitalises the imperative with "!"', () => {
    const springa = entry({
      lemma: 'springa',
      pos: 'verb',
      // intentionally out of order to prove ordering
      inflections: { imperativ: 'spring', presens: 'springer', supinum: 'sprungit', preteritum: 'sprang' },
    })
    const display = sv.renderInflections(springa)
    expect(display.summary).toBe('springer · sprang · sprungit · Spring!')
    expect(display.rows.map((r) => r.label)).toEqual(['presens', 'preteritum', 'supinum', 'imperativ'])
  })

  it('builds a 2×2 declension grid, repeating the lemma as indefinite singular', () => {
    const hund = entry({
      lemma: 'hund',
      pos: 'noun',
      features: { gender: 'en' },
      inflections: { definitePlural: 'hundarna', definiteSingular: 'hunden', indefinitePlural: 'hundar' },
    })
    const table = sv.renderInflections(hund).table
    expect(table).toEqual({
      columns: ['Singular', 'Plural'],
      rows: [
        { label: 'Indefinite', cells: ['hund', 'hundar'] },
        { label: 'Definite', cells: ['hunden', 'hundarna'] },
      ],
    })
  })

  it('drops the plural column and the article for uncountable nouns, keeping the gender badge', () => {
    const vatten = entry({
      lemma: 'vatten',
      pos: 'noun',
      features: { gender: 'ett', countable: 'no' },
      inflections: { definiteSingular: 'vattnet' },
    })
    expect(sv.renderLemma(vatten)).toBe('vatten')
    // Both columns are kept; the plural cells are empty (no nonsensical forms).
    expect(sv.renderInflections(vatten).table).toEqual({
      columns: ['Singular', 'Plural'],
      rows: [
        { label: 'Indefinite', cells: ['vatten', ''] },
        { label: 'Definite', cells: ['vattnet', ''] },
      ],
    })
    expect(sv.renderFeatures(vatten)).toEqual([{ label: 'ett', kind: 'gender-ett' }])
  })

  it('renders adjective comparison as a one-liner', () => {
    const display = sv.renderInflections(
      entry({ lemma: 'stor', pos: 'adj', inflections: { komparativ: 'större', superlativ: 'störst' } }),
    )
    expect(display.table).toBeUndefined()
    expect(display.summary).toBe('större · störst')
  })

  it('exposes POS-specific editable inflection slots', () => {
    expect(sv.inflectionSlots('noun').map((s) => s.key)).toEqual([
      'definiteSingular',
      'indefinitePlural',
      'definitePlural',
    ])
    expect(sv.inflectionSlots('verb').map((s) => s.key)).toEqual(['presens', 'preteritum', 'supinum', 'imperativ'])
    expect(sv.inflectionSlots('adj').map((s) => s.key)).toEqual(['komparativ', 'superlativ'])
    expect(sv.inflectionSlots('interj')).toEqual([])
  })

  it('keeps verbs as a one-line summary (no table)', () => {
    const display = sv.renderInflections(
      entry({
        lemma: 'springa',
        pos: 'verb',
        inflections: { presens: 'springer', preteritum: 'sprang', supinum: 'sprungit', imperativ: 'spring' },
      }),
    )
    expect(display.table).toBeUndefined()
    expect(display.summary).toBe('springer · sprang · sprungit · Spring!')
  })

  it('exposes gender as a colour-codeable feature badge', () => {
    expect(sv.renderFeatures(entry({ lemma: 'hund', pos: 'noun', features: { gender: 'en' } }))).toEqual([
      { label: 'en', kind: 'gender-en' },
    ])
    expect(sv.renderFeatures(entry({ lemma: 'springa', pos: 'verb' }))).toEqual([])
  })

  it('shows IPA for the target language', () => {
    expect(sv.showIpa).toBe(true)
  })
})

describe('enRenderer', () => {
  const en = getRenderer('en')

  it('renders verbs with "to" and nouns with a/an by leading sound', () => {
    expect(en.renderLemma(entry({ lemma: 'run', pos: 'verb', lang: 'en' }))).toBe('to run')
    expect(en.renderLemma(entry({ lemma: 'cat', pos: 'noun', lang: 'en' }))).toBe('a cat')
    expect(en.renderLemma(entry({ lemma: 'apple', pos: 'noun', lang: 'en' }))).toBe('an apple')
  })

  it('drops the article for uncountable nouns', () => {
    expect(en.renderLemma(entry({ lemma: 'water', pos: 'noun', lang: 'en', features: { countable: 'no' } }))).toBe(
      'water',
    )
  })

  it('hides IPA for the native language', () => {
    expect(en.showIpa).toBe(false)
  })
})

describe('getRenderer fallback', () => {
  it('returns a safe default for unknown languages', () => {
    const r = getRenderer('xx')
    expect(r.renderLemma(entry({ lemma: 'foo', pos: 'noun', lang: 'xx' }))).toBe('foo')
    expect(r.renderFeatures(entry({ lemma: 'foo', pos: 'noun', lang: 'xx' }))).toEqual([])
  })
})

describe('infinitivizeVerbIpa', () => {
  it('leaves an already-infinitive transcription (ends in a vowel) unchanged', () => {
    expect(infinitivizeVerbIpa('²sprˈɪŋːa', 'springa', 'springer')).toBe('²sprˈɪŋːa')
    expect(infinitivizeVerbIpa('²tˈɑːla', 'tala', 'talar')).toBe('²tˈɑːla')
  })

  it('drops the trailing r for -ar group / vowel-stems (presens = lemma + "r")', () => {
    expect(infinitivizeVerbIpa('²stˈaʈːar', 'starta', 'startar')).toBe('²stˈaʈːa')
    expect(infinitivizeVerbIpa('goːr', 'gå', 'går')).toBe('goː')
    expect(infinitivizeVerbIpa('beːr', 'be', 'ber')).toBe('beː')
  })

  it('replaces the -er ending with -a for group 2/4 verbs', () => {
    expect(infinitivizeVerbIpa('rˈiːvɛr', 'riva', 'river')).toBe('rˈiːva')
    expect(infinitivizeVerbIpa('sˈɛtːɛr', 'sätta', 'sätter')).toBe('sˈɛtːa')
    expect(infinitivizeVerbIpa('lˈɛːsɛr', 'läsa', 'läser')).toBe('lˈɛːsa')
  })

  it('appends -a for strong stem-present verbs (lemma = presens + "a")', () => {
    expect(infinitivizeVerbIpa('føːr', 'föra', 'för')).toBe('føːra')
    expect(infinitivizeVerbIpa('bɛːr', 'bära', 'bär')).toBe('bɛːra')
    expect(infinitivizeVerbIpa('²jˈɛmːføːr', 'jämföra', 'jämför')).toBe('²jˈɛmːføːra')
  })

  it('drops the IPA when the form cannot be reconstructed', () => {
    expect(infinitivizeVerbIpa('glˈɛːdɛr', 'glädja', 'gläder')).toBeUndefined()
    expect(infinitivizeVerbIpa('²mˈuːtstoːr', 'motstå', undefined)).toBeUndefined()
  })
})

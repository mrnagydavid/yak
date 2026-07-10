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
    expect(display.summary).toEqual(['springer · sprang · sprungit · Spring!'])
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

  it('parenthesises the article for uncountable nouns, keeping the gender and dropping the plural', () => {
    const vatten = entry({
      lemma: 'vatten',
      pos: 'noun',
      features: { gender: 'ett', countable: 'no' },
      // The seed often carries a rare "types-of" plural on a mass noun; the card must still blank it.
      inflections: { definiteSingular: 'vattnet', indefinitePlural: 'vatten', definitePlural: 'vattnen' },
    })
    // The article stays visible but parenthesised — Practice still teaches en/ett (its only cue there)
    // and the word reads as a noun, while signalling that "ett vatten" isn't idiomatic.
    expect(sv.renderLemma(vatten)).toBe('(ett) vatten')
    // Both columns are kept, but the plural cells are blanked despite the data carrying a plural —
    // an uncountable headword shouldn't advertise "isar"/"vattnen".
    expect(sv.renderInflections(vatten).table).toEqual({
      columns: ['Singular', 'Plural'],
      rows: [
        { label: 'Indefinite', cells: ['vatten', ''] },
        { label: 'Definite', cells: ['vattnet', ''] },
      ],
    })
    expect(sv.renderFeatures(vatten)).toEqual([{ label: 'ett', kind: 'gender-ett' }])
  })

  it('renders proper nouns bare — no article at all, whatever the gender', () => {
    // Languages, religions, holidays, weekdays: names, not common nouns.
    expect(sv.renderLemma(entry({ lemma: 'engelska', pos: 'noun', features: { gender: 'en', proper: 'yes' } }))).toBe('engelska')
    expect(sv.renderLemma(entry({ lemma: 'islam', pos: 'noun', features: { gender: 'en', proper: 'yes' } }))).toBe('islam')
    expect(sv.renderLemma(entry({ lemma: 'nyår', pos: 'noun', features: { gender: 'ett', proper: 'yes' } }))).toBe('nyår')
    // proper wins over countable if both were ever set.
    expect(sv.renderLemma(entry({ lemma: 'maj', pos: 'noun', features: { gender: 'en', proper: 'yes', countable: 'no' } }))).toBe('maj')
  })

  it('renders a genderless uncountable bare (nothing to parenthesise)', () => {
    expect(sv.renderLemma(entry({ lemma: 'aids', pos: 'noun', features: { countable: 'no' } }))).toBe('aids')
  })

  it('renders adjective comparison as a one-liner', () => {
    const display = sv.renderInflections(
      entry({ lemma: 'stor', pos: 'adj', inflections: { komparativ: 'större', superlativ: 'störst' } }),
    )
    expect(display.table).toBeUndefined()
    expect(display.summary).toEqual(['större · störst'])
  })

  it('splits adjective forms into agreement and comparison lines', () => {
    const display = sv.renderInflections(
      entry({
        lemma: 'liten',
        pos: 'adj',
        // intentionally out of order to prove the renderer groups + orders by GROUPS
        inflections: { superlativ: 'minst', plural: 'små', komparativ: 'mindre', neutrum: 'litet' },
      }),
    )
    // Two lines: agreement (neuter · plural), then comparison (comparative · superlative).
    expect(display.summary).toEqual(['litet · små', 'mindre · minst'])
    expect(display.rows.map((r) => r.label)).toEqual(['neutrum', 'plural', 'komparativ', 'superlativ'])
  })

  it('renders pronoun other forms on a single line (neuter · plural)', () => {
    const display = sv.renderInflections(
      entry({ lemma: 'min', pos: 'pron', inflections: { neutrum: 'mitt', plural: 'mina' } }),
    )
    expect(display.table).toBeUndefined()
    expect(display.summary).toEqual(['mitt · mina'])
  })

  it('exposes POS-specific editable inflection slots', () => {
    expect(sv.inflectionSlots('noun').map((s) => s.key)).toEqual([
      'definiteSingular',
      'indefinitePlural',
      'definitePlural',
    ])
    expect(sv.inflectionSlots('verb').map((s) => s.key)).toEqual(['presens', 'preteritum', 'supinum', 'imperativ'])
    expect(sv.inflectionSlots('adj').map((s) => s.key)).toEqual(['neutrum', 'plural', 'komparativ', 'superlativ'])
    expect(sv.inflectionSlots('pron').map((s) => s.key)).toEqual(['neutrum', 'plural'])
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
    expect(display.summary).toEqual(['springer · sprang · sprungit · Spring!'])
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

  it('picks a/an by SOUND for words whose spelling and pronunciation disagree', () => {
    // vowel letter, consonant sound → "a" (was "an one", "an university", …)
    expect(en.renderLemma(entry({ lemma: 'one', pos: 'noun', lang: 'en' }))).toBe('a one')
    expect(en.renderLemma(entry({ lemma: 'university', pos: 'noun', lang: 'en' }))).toBe('a university')
    expect(en.renderLemma(entry({ lemma: 'union', pos: 'noun', lang: 'en' }))).toBe('a union')
    expect(en.renderLemma(entry({ lemma: 'European', pos: 'noun', lang: 'en' }))).toBe('a European')
    expect(en.renderLemma(entry({ lemma: 'use, usage, application', pos: 'noun', lang: 'en' }))).toBe(
      'a use, usage, application',
    )
    // consonant letter, vowel sound (silent h) → "an" (was "a hour", "a honesty", …)
    expect(en.renderLemma(entry({ lemma: 'hour', pos: 'noun', lang: 'en' }))).toBe('an hour')
    expect(en.renderLemma(entry({ lemma: 'heir, heiress', pos: 'noun', lang: 'en' }))).toBe('an heir, heiress')
    // look-alikes that must stay on the letter rule: /ʌ/ u-words keep "an"
    expect(en.renderLemma(entry({ lemma: 'understanding', pos: 'noun', lang: 'en' }))).toBe('an understanding')
    expect(en.renderLemma(entry({ lemma: 'umbrella', pos: 'noun', lang: 'en' }))).toBe('an umbrella')
  })

  it('drops the article for uncountable nouns', () => {
    expect(en.renderLemma(entry({ lemma: 'water', pos: 'noun', lang: 'en', features: { countable: 'no' } }))).toBe(
      'water',
    )
  })

  it('drops the article for proper nouns (names take no "a/an")', () => {
    // Regression: months/weekdays/languages/religions were tagged noun and rendered "a May", "a December".
    expect(en.renderLemma(entry({ lemma: 'May', pos: 'noun', lang: 'en', features: { proper: 'yes' } }))).toBe('May')
    expect(en.renderLemma(entry({ lemma: 'English', pos: 'noun', lang: 'en', features: { proper: 'yes' } }))).toBe('English')
    expect(en.renderLemma(entry({ lemma: 'Islam', pos: 'noun', lang: 'en', features: { proper: 'yes' } }))).toBe('Islam')
    // Applies across "; "-joined meanings too, and whatever the stored POS.
    expect(en.renderLemma(entry({ lemma: 'Christmas; Yule', pos: 'noun', lang: 'en', features: { proper: 'yes' } }))).toBe(
      'Christmas; Yule',
    )
  })

  it('articles each co-equal meaning of a "; "-joined translation independently', () => {
    expect(en.renderLemma(entry({ lemma: 'race; breed', pos: 'noun', lang: 'en' }))).toBe('a race; a breed')
    expect(en.renderLemma(entry({ lemma: 'duty; tax', pos: 'noun', lang: 'en' }))).toBe('a duty; a tax')
    expect(en.renderLemma(entry({ lemma: 'flee; race', pos: 'verb', lang: 'en' }))).toBe('to flee; to race')
    // Uncountable applies across all meanings; comma-joined synonyms stay one meaning (one article).
    expect(en.renderLemma(entry({ lemma: 'abuse; assault', pos: 'noun', lang: 'en', features: { countable: 'no' } }))).toBe(
      'abuse; assault',
    )
    expect(en.renderLemma(entry({ lemma: 'big, large', pos: 'adj', lang: 'en' }))).toBe('big, large')
  })

  it('does not double an article a meaning already carries', () => {
    expect(en.renderLemma(entry({ lemma: 'the police; a force', pos: 'noun', lang: 'en' }))).toBe('the police; a force')
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

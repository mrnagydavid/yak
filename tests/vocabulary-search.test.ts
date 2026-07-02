import { describe, expect, it } from 'vitest'
import { matchesSearch } from '../src/components/VocabularyScreen/search'
import type { VocabRow } from '../src/db/queries'

// Minimal VocabRow — only the fields matchesSearch reads (lemma, meanings, note) matter.
const row = (lemma: string, meanings: string[], note?: string): VocabRow =>
  ({ entry: { lemma }, meanings, note }) as unknown as VocabRow

describe('Vocabulary search — matchesSearch', () => {
  // The regression: `man` has a promoted "husband" meaning, so "husband" must find it as well as
  // `make` (whose primary is "husband, spouse"). Before, only the primary was searchable.
  it('surfaces a word by a promoted (non-primary) meaning', () => {
    const make = row('make', ['husband, spouse'])
    const man = row('man', ['man', 'husband'])
    const other = row('kvinna', ['woman'])
    expect(matchesSearch(make, 'husband', 'contains')).toBe(true)
    expect(matchesSearch(man, 'husband', 'contains')).toBe(true)
    expect(matchesSearch(other, 'husband', 'contains')).toBe(false)
  })

  it('still matches lemma, primary translation, and note', () => {
    const r = row('hund', ['dog'], 'my pet')
    expect(matchesSearch(r, 'hund', 'contains')).toBe(true) // lemma
    expect(matchesSearch(r, 'dog', 'contains')).toBe(true) // primary meaning
    expect(matchesSearch(r, 'pet', 'contains')).toBe(true) // note
    expect(matchesSearch(r, 'cat', 'contains')).toBe(false)
  })

  it('applies match modes to the promoted meaning too', () => {
    const man = row('man', ['man', 'husband'])
    expect(matchesSearch(man, 'hus', 'starts')).toBe(true) // "husband".startsWith("hus")
    expect(matchesSearch(man, 'usband', 'starts')).toBe(false) // starts-with is anchored
    expect(matchesSearch(man, 'husband', 'exact')).toBe(true) // exact meaning match
    expect(matchesSearch(man, 'hus', 'exact')).toBe(false) // not an exact meaning
  })
})

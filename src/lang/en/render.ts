import type { Entry } from '../../db/types'
import type { FeatureBadge, InflectionDisplay, InflectionRow, LanguageRenderer } from '../types'

function indefiniteArticle(word: string): string {
  // Approximate: "an" before a vowel letter. The true rule is phonetic ("an hour",
  // "a university"); a letter-based heuristic is good enough for v1 display. (SPEC §5.1)
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}

export const enRenderer: LanguageRenderer = {
  showIpa: false, // English is the native language — no IPA in display (SPEC §5.1)

  renderLemma(entry: Entry): string {
    if (entry.pos === 'verb') return `to ${entry.lemma}`
    if (entry.pos === 'noun') {
      // Uncountable nouns take no article (e.g. "water", not "a water").
      if (entry.features.countable === 'no') return entry.lemma
      return `${indefiniteArticle(entry.lemma)} ${entry.lemma}`
    }
    return entry.lemma
  },

  renderInflections(entry: Entry): InflectionDisplay {
    const rows: InflectionRow[] = Object.entries(entry.inflections).map(([label, value]) => ({
      label,
      value,
    }))
    return { summary: rows.map((r) => r.value).join(' · '), rows }
  },

  renderFeatures(): FeatureBadge[] {
    return [] // no gender/feature badges for English
  },
}

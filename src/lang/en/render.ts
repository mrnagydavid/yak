import type { Entry } from '../../db/types'
import type { FeatureBadge, InflectionDisplay, InflectionRow, LanguageRenderer } from '../types'

function indefiniteArticle(word: string): string {
  // Approximate: "an" before a vowel letter. The true rule is phonetic ("an hour",
  // "a university"); a letter-based heuristic is good enough for v1 display. (SPEC §5.1)
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}

// Article/particle a single meaning per POS: "to" for verbs, "a/an" for countable nouns.
function articleize(entry: Entry, meaning: string): string {
  if (entry.pos === 'verb') return /^to\s/i.test(meaning) ? meaning : `to ${meaning}`
  if (entry.pos === 'noun') {
    // Uncountable nouns take no article (e.g. "water", not "a water").
    if (entry.features.countable === 'no') return meaning
    // Don't double up if the translation already carries an article.
    if (/^(an?|the)\s/i.test(meaning)) return meaning
    return `${indefiniteArticle(meaning)} ${meaning}`
  }
  return meaning
}

export const enRenderer: LanguageRenderer = {
  showIpa: false, // English is the native language — no IPA in display (SPEC §5.1)

  renderLemma(entry: Entry): string {
    // A translation may carry two co-equal meanings separated by ";" ("race; breed") — article each
    // independently so both read naturally ("a race; a breed", "to flee; to race"). A single-meaning
    // translation has no ";" and is unchanged. (Within a meaning, "," joins synonyms — one article.)
    return entry.lemma
      .split(';')
      .map((m) => m.trim())
      .filter(Boolean)
      .map((m) => articleize(entry, m))
      .join('; ')
  },

  renderInflections(entry: Entry): InflectionDisplay {
    const rows: InflectionRow[] = Object.entries(entry.inflections).map(([label, value]) => ({
      label,
      value,
    }))
    const line = rows.map((r) => r.value).join(' · ')
    return { summary: line ? [line] : [], rows }
  },

  renderFeatures(): FeatureBadge[] {
    return [] // no gender/feature badges for English
  },

  inflectionSlots: () => [], // English is the native language — not edited in v1
}

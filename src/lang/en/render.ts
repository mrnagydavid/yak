import type { Entry } from '../../db/types'
import type { FeatureBadge, InflectionDisplay, InflectionRow, LanguageRenderer } from '../types'

// Words whose initial SOUND diverges from their initial LETTER, so the plain letter rule ("an"
// before a vowel) picks the wrong article. Spelling can't tell these apart from their look-alikes —
// "a unit" (/juː/) vs "an under-…" (/ʌ/), "an hour" (silent h) vs "a house" — so we override on the
// first word explicitly and fall back to the letter heuristic for everything else. Keyed on the
// lowercased first word; extend as new glosses need it. (SPEC §5.1)
const CONSONANT_SOUND_WORDS = new Set([
  // vowel letter, but a /juː/ or /w/ onset → take "a"
  'one', 'once', 'unit', 'union', 'uniform', 'unique', 'universe', 'university', 'unanimity',
  'unison', 'unity', 'unicorn', 'use', 'usage', 'user', 'usual', 'usefulness', 'utopia',
  'euro', 'europe', 'european', 'ewe', 'uranium', 'ukulele',
])
const VOWEL_SOUND_WORDS = new Set([
  // consonant letter, but a silent h → vowel onset → take "an"
  'hour', 'honest', 'honesty', 'honor', 'honour', 'honorable', 'honourable', 'heir', 'heiress',
])

function indefiniteArticle(word: string): string {
  const first = word.toLowerCase().match(/[a-z]+/)?.[0] ?? ''
  if (VOWEL_SOUND_WORDS.has(first)) return 'an'
  if (CONSONANT_SOUND_WORDS.has(first)) return 'a'
  // Fallback: "an" before a vowel letter — a good phonetic approximation for the rest. (SPEC §5.1)
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}

// Article/particle a single meaning per POS: "to" for verbs, "a/an" for countable nouns.
function articleize(entry: Entry, meaning: string): string {
  // Proper nouns are names, not common nouns — they take no indefinite article ("May", "English",
  // "Islam", not "a May"). Distinct from `countable: 'no'` (a proper noun can still pluralize) but
  // renders the same: bare. Checked first so it applies whatever the stored POS. (SPEC §5.1)
  if (entry.features.proper === 'yes') return meaning
  if (entry.pos === 'verb') {
    // A gloss with no infinitive (English modals — "should", "must", "may"; or an epistemic phrase
    // like "probably, likely") takes no "to". `features.infinitive === 'no'` marks it (SPEC §5.1).
    if (entry.features.infinitive === 'no') return meaning
    return /^to\s/i.test(meaning) ? meaning : `to ${meaning}`
  }
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

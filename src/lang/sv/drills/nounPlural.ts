import type { Entry } from '../../../db/types'
import type { DrillMeta } from '../../../drills/types'

// The Swedish noun-plural drill — the language-COUPLED half: eligibility and answer-checking. (Its UI
// is NounPluralDrill.tsx, alongside.) It's single-direction: read the singular and type the indefinite
// plural. The reverse (plural → singular) is left out on purpose — the difficulty is remembering which
// ending a noun takes (-or/-ar/-er/-n/unchanged), and that only bites when PRODUCING the plural;
// recovering the singular is mostly just stripping the ending. Unlike the verb/adjective drills, ALL
// countable nouns qualify: Swedish plural formation isn't mechanically predictable from the lemma, so
// there's no "regular" subset to skip.

/** A present, non-placeholder inflection (Wiktionary marks a missing form as "-"). */
function form(entry: Entry, key: string): string | undefined {
  const v = entry.inflections[key]
  return v && v !== '-' ? v : undefined
}

/**
 * Whether a word can appear in the noun-plural drill: a countable common noun with an indefinite plural,
 * not manually skipped, and already MET in normal practice (we drill grammar of words the learner is
 * learning, never cold-quiz unseen ones). Proper nouns (names) and uncountables are excluded — a plural
 * there is spurious (the same reason the noun card blanks their plural column). `met` is supplied by the
 * caller (it owns the review data).
 */
export function isNounPluralEligible(entry: Entry, met: boolean): boolean {
  return (
    entry.pos === 'noun' &&
    entry.study !== 'skip' &&
    met &&
    entry.features.proper !== 'yes' &&
    entry.features.countable !== 'no' &&
    !!form(entry, 'indefinitePlural')
  )
}

// Normalize a typed answer: trim + lowercase. (Plurals never take an en/ett article, so there's nothing
// else to strip.)
export function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase()
}

/** Whether a typed answer matches the noun's indefinite plural. */
export function checkAnswer(entry: Entry, typed: string): boolean {
  const guess = normalizeAnswer(typed)
  if (!guess) return false
  return guess === normalizeAnswer(entry.inflections.indefinitePlural ?? '')
}

/** Registry entry for the Swedish noun-plural drill. */
export const nounPluralDrillMeta: DrillMeta = {
  type: 'sv:nounPlural',
  title: 'Noun plurals',
  description: 'Swedish plurals — turn a singular noun into its plural form.',
  funFact:
    'Fun fact: Swedish nouns fall into five plural patterns — -or, -ar, -er, -n, or no change at all (ett hus → hus). The article (en/ett) hints at which, but only hints.',
  eligible: isNounPluralEligible,
}

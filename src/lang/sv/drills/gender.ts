import type { Entry } from '../../../db/types'
import type { DrillMeta } from '../../../drills/types'

// The Swedish en/ett drill — the language-COUPLED half: eligibility, answer-checking, and the hub copy.
// (Its UI is GenderDrill.tsx, alongside.) A different target language brings its own module here, e.g.
// a German `der/die/das` drill, without touching the agnostic core in src/drills/.

export type Gender = 'en' | 'ett'

/**
 * Whether a word can appear in the en/ett drill. It must be a noun that actually has a gender to
 * guess, must not be manually skipped, and must have been MET in normal practice — we drill the
 * grammar of words the learner is already learning, never cold-quiz unseen ones. `met` (has a
 * recognition review state) is supplied by the caller, which owns the review data.
 */
export function isGenderEligible(entry: Entry, met: boolean): boolean {
  return (
    entry.pos === 'noun' &&
    (entry.features.gender === 'en' || entry.features.gender === 'ett') &&
    entry.study !== 'skip' &&
    met
  )
}

/** The correct answer for a noun's gender question — the article it takes, or null if it has none. */
export function genderAnswer(entry: Entry): Gender | null {
  const g = entry.features.gender
  return g === 'en' || g === 'ett' ? g : null
}

/** Registry entry for the Swedish en/ett drill. */
export const genderDrillMeta: DrillMeta = {
  type: 'sv:gender',
  title: 'en / ett',
  description: 'Guess whether a Swedish noun takes en or ett.',
  funFact: 'Fun fact: roughly 3 in 4 Swedish nouns are en-words — so when you’re unsure, en is the safer guess.',
  eligible: isGenderEligible,
}

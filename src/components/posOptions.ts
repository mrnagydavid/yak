import type { PartOfSpeech } from '../db/types'

/** Part-of-speech choices for the Add / edit forms. */
export const POS_OPTIONS: { value: PartOfSpeech; label: string }[] = [
  { value: 'noun', label: 'Noun' },
  { value: 'verb', label: 'Verb' },
  { value: 'adj', label: 'Adjective' },
  { value: 'adv', label: 'Adverb' },
  { value: 'prep', label: 'Preposition' },
  { value: 'conj', label: 'Conjunction' },
  { value: 'pron', label: 'Pronoun' },
  { value: 'num', label: 'Numeral' },
  { value: 'interj', label: 'Interjection' },
  { value: 'phrase', label: 'Phrase' },
  { value: 'other', label: 'Other' },
]

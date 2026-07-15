import type { Entry, PartOfSpeech } from '../db/types'
import { enRenderer } from './en/render'
import { svRenderer } from './sv/render'
import type { InflectionDisplay, LanguageRenderer } from './types'

const RENDERERS: Record<string, LanguageRenderer> = {
  sv: svRenderer,
  en: enRenderer,
}

// Fallback for languages without a dedicated module: lemma as-is, inflections joined, IPA on.
const defaultRenderer: LanguageRenderer = {
  showIpa: true,
  renderLemma: (entry: Entry) => entry.lemma,
  renderInflections: (entry: Entry): InflectionDisplay => {
    const rows = Object.entries(entry.inflections).map(([label, value]) => ({ label, value }))
    const line = rows.map((r) => r.value).join(' · ')
    return { summary: line ? [line] : [], rows }
  },
  renderFeatures: () => [],
  inflectionSlots: () => [],
}

/** The renderer for a BCP-47 language code, or a safe fallback. */
export function getRenderer(lang: string): LanguageRenderer {
  return RENDERERS[lang] ?? defaultRenderer
}

const LANGUAGE_NAMES: Record<string, string> = {
  sv: 'Swedish',
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
}

/** Human-readable language name for a BCP-47 code (falls back to the code). */
export function languageName(lang: string): string {
  return LANGUAGE_NAMES[lang] ?? lang
}

/** Wiktionary stores multi-word entries with no sentence capital and no terminal punctuation
 *  (title `alla vägar bär till Rom`, not our seed lemma `Alla vägar bär till Rom.`), and its first
 *  letter is case-sensitive — so the raw lemma 404s. For a phrase the leading capital and the final
 *  `. ! ? …` are sentence grammar, safe to shed; the first letter lowercases. Single words are left
 *  untouched: their case is inherent (`Sverige`) and any trailing dot is part of the lemma (`t.ex.`). */
function wiktionaryTitle(lemma: string, pos?: PartOfSpeech): string {
  if (pos !== 'phrase') return lemma
  const trimmed = lemma.trim().replace(/[.!?…]+$/, '').trim()
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1)
}

/** English-Wiktionary page for a word, jumped to its language section (e.g. `#Swedish`). Offered
 *  without an existence check — Wiktionary shows a helpful "no entry" page when the word is absent. */
export function wiktionaryUrl(lemma: string, lang: string, pos?: PartOfSpeech): string {
  const title = wiktionaryTitle(lemma, pos)
  return `https://en.wiktionary.org/wiki/${encodeURIComponent(title)}#${encodeURIComponent(languageName(lang))}`
}

export type { FeatureBadge, InflectionDisplay, InflectionRow, LanguageRenderer } from './types'

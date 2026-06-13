import type { Entry } from '../db/types'
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
    return { summary: rows.map((r) => r.value).join(' · '), rows }
  },
  renderFeatures: () => [],
}

/** The renderer for a BCP-47 language code, or a safe fallback. */
export function getRenderer(lang: string): LanguageRenderer {
  return RENDERERS[lang] ?? defaultRenderer
}

export type { FeatureBadge, InflectionDisplay, InflectionRow, LanguageRenderer } from './types'

import type { Entry } from '../../db/types'
import type {
  FeatureBadge,
  InflectionDisplay,
  InflectionRow,
  InflectionTable,
  LanguageRenderer,
} from '../types'

// Swedish principal forms, in the order they're conventionally taught. Unknown keys fall
// back to insertion order after these.
const VERB_ORDER = ['presens', 'preteritum', 'supinum', 'imperativ']
// Noun declension: definite singular, indefinite plural, definite plural (the indefinite
// singular is the lemma/headword). e.g. hund → hunden · hundar · hundarna.
const NOUN_ORDER = ['definiteSingular', 'indefinitePlural', 'definitePlural']

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatValue(key: string, value: string): string {
  // The imperative reads naturally capitalised with "!", e.g. "Spring!".
  return key === 'imperativ' ? `${capitalize(value)}!` : value
}

// Build the 2×2 declension grid. The indefinite singular is the lemma itself (repeated for
// a complete table). Always returns both columns; uncountable nouns leave the plural cells
// empty (consumers can keep the column for layout or drop it if they prefer).
function nounTable(entry: Entry): InflectionTable {
  const indefiniteSingular = entry.lemma
  const { definiteSingular, indefinitePlural, definitePlural } = entry.inflections
  return {
    columns: ['Singular', 'Plural'],
    rows: [
      { label: 'Indefinite', cells: [indefiniteSingular, indefinitePlural ?? ''] },
      { label: 'Definite', cells: [definiteSingular ?? '', definitePlural ?? ''] },
    ],
  }
}

export const svRenderer: LanguageRenderer = {
  showIpa: true,

  renderLemma(entry: Entry): string {
    if (entry.pos === 'verb') return `att ${entry.lemma}`
    if (entry.pos === 'noun') {
      const gender = entry.features.gender // "en" | "ett"
      // Uncountable nouns take no article (e.g. "vatten", not "ett vatten").
      if (entry.features.countable === 'no' || !gender) return entry.lemma
      return `${gender} ${entry.lemma}`
    }
    return entry.lemma
  },

  renderInflections(entry: Entry): InflectionDisplay {
    const keys = Object.keys(entry.inflections)
    const order = entry.pos === 'verb' ? VERB_ORDER : entry.pos === 'noun' ? NOUN_ORDER : []
    const ordered = order.length
      ? [...order.filter((k) => k in entry.inflections), ...keys.filter((k) => !order.includes(k))]
      : keys
    const rows: InflectionRow[] = ordered.map((key) => ({
      label: key,
      value: formatValue(key, entry.inflections[key]),
    }))
    const summary = rows.map((r) => r.value).join(' · ')
    // Nouns read more clearly as a 2×2 declension grid (indefinite/definite × sg/pl).
    return entry.pos === 'noun'
      ? { summary, rows, table: nounTable(entry) }
      : { summary, rows }
  },

  renderFeatures(entry: Entry): FeatureBadge[] {
    const gender = entry.features.gender
    if (entry.pos === 'noun' && gender) {
      return [{ label: gender, kind: `gender-${gender}` }]
    }
    return []
  },
}

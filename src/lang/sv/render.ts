import type { Entry, PartOfSpeech } from '../../db/types'
import { infinitivizeVerbIpa } from './ipa'
import type {
  FeatureBadge,
  InflectionDisplay,
  InflectionRow,
  InflectionSlot,
  InflectionTable,
  LanguageRenderer,
} from '../types'

// Swedish forms grouped by grammatical dimension, in the order they're conventionally taught.
// Each group becomes one summary line on the card; flattened, a group list is also the display
// order. Adjectives split agreement (neuter, plural) from comparison (comparative, superlative) so
// the two dimensions read clearly on separate lines; every other POS is a single dimension → one
// line. (Nouns render as a 2×2 grid instead of the summary, but keep the group for row ordering.)
const GROUPS: Partial<Record<PartOfSpeech, string[][]>> = {
  verb: [['presens', 'preteritum', 'supinum', 'imperativ']],
  noun: [['definiteSingular', 'indefinitePlural', 'definitePlural']],
  adj: [
    ['neutrum', 'plural'],
    ['komparativ', 'superlativ'],
  ],
  pron: [['neutrum', 'plural']],
}

const SLOTS: Partial<Record<PartOfSpeech, InflectionSlot[]>> = {
  noun: [
    { key: 'definiteSingular', label: 'Definite singular' },
    { key: 'indefinitePlural', label: 'Indefinite plural' },
    { key: 'definitePlural', label: 'Definite plural' },
  ],
  verb: [
    { key: 'presens', label: 'Present' },
    { key: 'preteritum', label: 'Past' },
    { key: 'supinum', label: 'Supine' },
    { key: 'imperativ', label: 'Imperative' },
  ],
  adj: [
    { key: 'neutrum', label: 'Neuter' },
    { key: 'plural', label: 'Plural' },
    { key: 'komparativ', label: 'Comparative' },
    { key: 'superlativ', label: 'Superlative' },
  ],
  pron: [
    { key: 'neutrum', label: 'Neuter' },
    { key: 'plural', label: 'Plural' },
  ],
}

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
  fixVerbIpa: infinitivizeVerbIpa,

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

  inflectionSlots(pos: PartOfSpeech): InflectionSlot[] {
    return SLOTS[pos] ?? []
  },

  renderInflections(entry: Entry): InflectionDisplay {
    const groups = GROUPS[entry.pos] ?? []
    const known = new Set(groups.flat())
    // Any unknown keys trail as a final line so nothing is silently dropped.
    const leftover = Object.keys(entry.inflections).filter((k) => !known.has(k))
    const lines = [...groups, leftover]
      .map((group) => group.filter((k) => k in entry.inflections))
      .filter((group) => group.length > 0)
    const rows: InflectionRow[] = lines.flat().map((key) => ({
      label: key,
      value: formatValue(key, entry.inflections[key]),
    }))
    // One summary line per dimension (e.g. adjective agreement vs comparison).
    const summary = lines.map((group) => group.map((k) => formatValue(k, entry.inflections[k])).join(' · '))
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

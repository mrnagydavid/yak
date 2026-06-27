import type { Entry, PartOfSpeech } from '../db/types'

/** An editable inflection slot for a POS (key matches Entry.inflections, label for the UI). */
export interface InflectionSlot {
  key: string
  label: string
}

export interface InflectionRow {
  label: string
  value: string
}

/** A 2-D inflection grid, e.g. a Swedish noun declension (rows × columns). */
export interface InflectionTable {
  columns: string[] // e.g. ["Singular", "Plural"] — a single column for uncountables
  rows: { label: string; cells: string[] }[] // cells aligned to `columns`
}

export interface InflectionDisplay {
  /** One-line summary for cards/rows, e.g. "springer · sprang · sprungit · Spring!". */
  summary: string
  /** Flat key/value rows for a generic table view (Word Detail). */
  rows: InflectionRow[]
  /** Structured grid for forms that read better as a table (nouns). Absent for verbs. */
  table?: InflectionTable
}

export interface FeatureBadge {
  label: string
  /** Optional kind for colour-coding, e.g. "gender-en" | "gender-ett". */
  kind?: string
}

/**
 * Per-language display logic. Adding a language is one render module + one seed file,
 * with no core code changes. (SPEC §5.1)
 */
export interface LanguageRenderer {
  /** Lemma for display, including POS-specific articles/particles (e.g. "att springa"). */
  renderLemma(entry: Entry): string
  /** Inflection block, as a one-line summary and structured rows. */
  renderInflections(entry: Entry): InflectionDisplay
  /** Gender or other feature badges. */
  renderFeatures(entry: Entry): FeatureBadge[]
  /** Editable inflection slots for a part of speech (drives the edit form). */
  inflectionSlots(pos: PartOfSpeech): InflectionSlot[]
  /** Whether to display IPA for this language (true for the target language). */
  showIpa: boolean
  /** Correct a verb's IPA from a conjugated form back to the infinitive headword, when the
   *  language's IPA source is prone to that (Swedish ipa-dict). Returns the corrected IPA, the
   *  input unchanged, or undefined to drop it. Absent → no correction needed. */
  fixVerbIpa?(ipa: string, lemma: string, presens?: string): string | undefined
}

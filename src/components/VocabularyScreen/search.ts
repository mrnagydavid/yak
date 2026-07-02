// Pure search / filter / sort logic for the Vocabulary screen, kept out of the component so it's
// unit-testable without a DOM or Dexie. The screen runs `applyFilters` over the loaded rows on a
// debounce; matching a promoted meaning is what lets a search on a hidden sense surface its word.
import type { VocabRow } from '../../db/queries'
import type { LevelFilter, MatchMode, SortOption, SourceFilter } from './filter-store'

function fieldMatches(field: string | undefined, q: string, mode: MatchMode): boolean {
  if (!field) return false
  const f = field.toLowerCase()
  if (mode === 'exact') return f === q
  if (mode === 'starts') return f.startsWith(q)
  return f.includes(q)
}

/** True when the query (already lowercased) hits the word, ANY of its practiced meanings (primary +
 *  promoted), or its note, under the given match mode. Matching every meaning is what surfaces a word
 *  by a promoted sense — e.g. "husband" finds `man`, whose primary is "man". Reference-only
 *  subDefinitions aren't practiced cards and aren't included. */
export function matchesSearch(row: VocabRow, q: string, mode: MatchMode): boolean {
  return (
    fieldMatches(row.entry.lemma, q, mode) ||
    row.meanings.some((m) => fieldMatches(m, q, mode)) ||
    fieldMatches(row.note, q, mode)
  )
}

export function applyFilters(
  rows: VocabRow[],
  search: string,
  match: MatchMode,
  source: SourceFilter,
  level: LevelFilter,
  sort: SortOption,
  lang: string,
): VocabRow[] {
  const q = search.trim().toLowerCase()
  const filtered = rows.filter((row) => {
    if (q && !matchesSearch(row, q, match)) return false
    if (source === 'study' && !row.inStudySet) return false
    if (source === 'added' && row.entry.source !== 'user') return false
    if (level === 'none' && row.entry.cefr) return false
    if (level !== 'all' && level !== 'none' && row.entry.cefr !== level) return false
    return true
  })

  // Collate alphabetically by the target language so e.g. Swedish å/ä/ö sort after z.
  const collator = new Intl.Collator(lang)
  const sorted = [...filtered]
  if (sort === 'alphabetical') sorted.sort((a, b) => collator.compare(a.entry.lemma, b.entry.lemma))
  else if (sort === 'practiced') sorted.sort((a, b) => (b.lastPracticed ?? 0) - (a.lastPracticed ?? 0))
  else if (sort === 'added') sorted.sort((a, b) => b.entry.createdAt - a.entry.createdAt)
  else if (sort === 'hardest') sorted.sort((a, b) => b.lapses - a.lapses)
  return sorted
}

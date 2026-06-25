// The Vocabulary screen's search/filter/sort selection, held outside the component lifecycle.
// preact-router unmounts the Vocabulary route when you open a word (or switch tabs), so keeping this
// in component state reset every filter on return. This module-level store lets the screen restore
// exactly what the user had set. (Same pattern as PracticeScreen's session-store.)

export type SourceFilter = 'all' | 'study' | 'added'
export type LevelFilter = 'all' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'none'
export type SortOption = 'alphabetical' | 'practiced' | 'added' | 'hardest'
export type MatchMode = 'contains' | 'starts' | 'exact'

export interface VocabFilters {
  search: string
  match: MatchMode
  source: SourceFilter
  level: LevelFilter
  sort: SortOption
}

let saved: VocabFilters = {
  search: '',
  match: 'contains',
  source: 'all',
  level: 'all',
  sort: 'alphabetical',
}

export function getFilters(): VocabFilters {
  return saved
}

export function saveFilters(filters: VocabFilters): void {
  saved = filters
}

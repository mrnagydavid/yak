import { useLiveQuery } from 'dexie-react-hooks'
import { route } from 'preact-router'
import { useMemo, useRef, useState } from 'preact/hooks'
import { getActiveProfile, listVocabulary, type Status, type VocabRow } from '../../db/queries'
import { getRenderer } from '../../lang'
import { FilterChip } from './FilterChip'
import styles from './VocabularyScreen.module.css'

const STATUS_GLYPH: Record<Status, string> = { none: '⚪', struggling: '🔴', learning: '🟡', solid: '🟢' }
const STATUS_LABEL: Record<Status, string> = {
  none: 'not started',
  struggling: 'struggling',
  learning: 'learning',
  solid: 'solid',
}

type SourceFilter = 'all' | 'study' | 'added'
type LevelFilter = 'all' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'none'
type SortOption = 'alphabetical' | 'practiced' | 'added' | 'hardest'
type MatchMode = 'contains' | 'starts' | 'exact'

const SOURCE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'study', label: 'In my study' },
  { value: 'added', label: 'Added by me' },
] as const
const LEVEL_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'A1', label: 'A1' },
  { value: 'A2', label: 'A2' },
  { value: 'B1', label: 'B1' },
  { value: 'B2', label: 'B2' },
  { value: 'C1', label: 'C1' },
  { value: 'C2', label: 'C2' },
  { value: 'none', label: 'No level' },
] as const
const SORT_OPTIONS = [
  { value: 'alphabetical', label: 'Alphabetical' },
  { value: 'practiced', label: 'Recently practiced' },
  { value: 'added', label: 'Recently added' },
  { value: 'hardest', label: 'Hardest first' },
] as const
const MATCH_OPTIONS = [
  { value: 'contains', label: 'Contains' },
  { value: 'starts', label: 'Starts with' },
  { value: 'exact', label: 'Exact' },
] as const

function fieldMatches(field: string | undefined, q: string, mode: MatchMode): boolean {
  if (!field) return false
  const f = field.toLowerCase()
  if (mode === 'exact') return f === q
  if (mode === 'starts') return f.startsWith(q)
  return f.includes(q)
}

function matchesSearch(row: VocabRow, q: string, mode: MatchMode): boolean {
  return (
    fieldMatches(row.entry.lemma, q, mode) ||
    fieldMatches(row.native, q, mode) ||
    fieldMatches(row.note, q, mode)
  )
}

function applyFilters(
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

export function VocabularyScreen() {
  const profile = useLiveQuery(() => getActiveProfile(), [])
  const rows = useLiveQuery(
    () => (profile ? listVocabulary(profile.targetLang, profile.claimedLevel) : Promise.resolve([])),
    [profile?.targetLang, profile?.claimedLevel],
  )

  const [search, setSearch] = useState('')
  const [match, setMatch] = useState<MatchMode>('contains')
  const [source, setSource] = useState<SourceFilter>('all')
  const [level, setLevel] = useState<LevelFilter>('all')
  const [sort, setSort] = useState<SortOption>('alphabetical')
  const [openFilter, setOpenFilter] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const renderer = profile ? getRenderer(profile.targetLang) : undefined
  const lang = profile?.targetLang ?? 'en'
  const visible = useMemo(
    () => (rows ? applyFilters(rows, search, match, source, level, sort, lang) : []),
    [rows, search, match, source, level, sort, lang],
  )

  return (
    <div class={styles.screen}>
      <div class={styles.searchWrap}>
        <input
          ref={searchRef}
          class={styles.search}
          type="search"
          placeholder="Search words, translations, notes"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
        />
        {search ? (
          <button
            class={styles.clear}
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setSearch('')
              searchRef.current?.focus()
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : null}
      </div>

      <div class={styles.filters}>
        <FilterChip
          label="Source"
          value={source}
          options={SOURCE_OPTIONS}
          open={openFilter === 'source'}
          onToggle={() => setOpenFilter((f) => (f === 'source' ? null : 'source'))}
          onChange={(v) => {
            setSource(v)
            setOpenFilter(null)
          }}
        />
        <FilterChip
          label="Level"
          value={level}
          options={LEVEL_OPTIONS}
          open={openFilter === 'level'}
          onToggle={() => setOpenFilter((f) => (f === 'level' ? null : 'level'))}
          onChange={(v) => {
            setLevel(v)
            setOpenFilter(null)
          }}
        />
        <FilterChip
          label="Match"
          value={match}
          options={MATCH_OPTIONS}
          open={openFilter === 'match'}
          onToggle={() => setOpenFilter((f) => (f === 'match' ? null : 'match'))}
          onChange={(v) => {
            setMatch(v)
            setOpenFilter(null)
          }}
        />
        <FilterChip
          label="Sort"
          value={sort}
          options={SORT_OPTIONS}
          open={openFilter === 'sort'}
          align="right"
          onToggle={() => setOpenFilter((f) => (f === 'sort' ? null : 'sort'))}
          onChange={(v) => {
            setSort(v)
            setOpenFilter(null)
          }}
        />
      </div>

      {rows === undefined ? (
        <p class={styles.placeholder}>Loading…</p>
      ) : visible.length === 0 ? (
        <p class={styles.placeholder}>No entries match your filter.</p>
      ) : (
        <ul class={styles.list}>
          {visible.map(({ entry, native, inStudySet, recognize, produce }) => (
            <li
              key={entry.id}
              class={`${styles.row} ${inStudySet ? '' : styles.dimmed}`}
              onClick={() => route(`/word/${entry.id}`)}
            >
              <span class={styles.level}>{entry.source === 'user' ? '⚝' : (entry.cefr ?? '–')}</span>
              <span
                class={styles.status}
                title={`recognise: ${STATUS_LABEL[recognize]} / produce: ${STATUS_LABEL[produce]}`}
              >
                {STATUS_GLYPH[recognize]}
                {STATUS_GLYPH[produce]}
              </span>
              <span class={styles.lemma}>
                {renderer ? renderer.renderLemma(entry) : entry.lemma}
                {entry.disambiguator ? <span class={styles.disambiguator}> ({entry.disambiguator})</span> : null}
              </span>
              {native ? <span class={styles.native}>→ {native}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

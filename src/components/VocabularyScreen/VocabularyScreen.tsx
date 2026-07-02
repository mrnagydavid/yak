import { useLiveQuery } from 'dexie-react-hooks'
import { route } from 'preact-router'
import { memo } from 'preact/compat'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { getActiveProfile, listVocabulary, type Status, type VocabRow } from '../../db/queries'
import { getRenderer, type LanguageRenderer } from '../../lang'
import { getFilters, type LevelFilter, type MatchMode, saveFilters, type SortOption, type SourceFilter } from './filter-store'
import { FilterChip } from './FilterChip'
import { applyFilters } from './search'
import styles from './VocabularyScreen.module.css'

const STATUS_GLYPH: Record<Status, string> = { none: '⚪', struggling: '🔴', learning: '🟡', solid: '🟢' }
const STATUS_LABEL: Record<Status, string> = {
  none: 'not started',
  struggling: 'struggling',
  learning: 'learning',
  solid: 'solid',
}

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

/** Lags `value` by `delayMs` so the (expensive) filter+sort over ~8.3k rows runs on a pause in
 *  typing, not on every keystroke. The input stays bound to the live value, so typing feels instant. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(handle)
  }, [value, delayMs])
  return debounced
}

/** The word list, memoised on its props. Typing updates the parent's `search` state (so the input
 *  stays responsive) but not `rows`/`renderer`, so memo skips re-rendering — without this, every
 *  keystroke re-diffs all ~8.3k rows, which is what made the input lag. The filtered list arrives on
 *  the debounce, when `rows` actually changes. */
const VocabList = memo(function VocabList({ rows, renderer }: { rows: VocabRow[]; renderer?: LanguageRenderer }) {
  return (
    <ul class={styles.list}>
      {rows.map(({ entry, meanings, inStudySet, recognize, produce }) => (
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
          {meanings.length ? <span class={styles.native}>→ {meanings.join(', ')}</span> : null}
        </li>
      ))}
    </ul>
  )
})

export function VocabularyScreen() {
  // Profile + vocabulary load in one reactive query. Chaining them as two queries briefly produced a
  // defined-but-empty `rows` (the no-profile branch resolved to []) before the real list arrived,
  // which flashed "No entries match your filter"; a single query has no such in-between state.
  const data = useLiveQuery(async () => {
    const profile = await getActiveProfile()
    const rows = profile ? await listVocabulary(profile.targetLang, profile.claimedLevel) : []
    return { profile, rows }
  }, [])
  const profile = data?.profile
  const rows = data?.rows
  const loading = data === undefined

  // Initialised from the module-level store so search/filters survive leaving the screen (e.g.
  // opening a word and coming back); `openFilter` is transient dropdown UI and isn't persisted.
  const initial = getFilters()
  const [search, setSearch] = useState(initial.search)
  const [match, setMatch] = useState<MatchMode>(initial.match)
  const [source, setSource] = useState<SourceFilter>(initial.source)
  const [level, setLevel] = useState<LevelFilter>(initial.level)
  const [sort, setSort] = useState<SortOption>(initial.sort)
  const [openFilter, setOpenFilter] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    saveFilters({ search, match, source, level, sort })
  }, [search, match, source, level, sort])

  const debouncedSearch = useDebouncedValue(search, 500)
  const renderer = profile ? getRenderer(profile.targetLang) : undefined
  const lang = profile?.targetLang ?? 'en'
  const visible = useMemo(
    () => (rows ? applyFilters(rows, debouncedSearch, match, source, level, sort, lang) : []),
    [rows, debouncedSearch, match, source, level, sort, lang],
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

      {loading ? (
        <div class={styles.loading} role="status" aria-label="Loading words">
          <div class={styles.spinner} />
        </div>
      ) : visible.length === 0 ? (
        <p class={styles.placeholder}>No entries match your filter.</p>
      ) : (
        <VocabList rows={visible} renderer={renderer} />
      )}
    </div>
  )
}

import { useLiveQuery } from 'dexie-react-hooks'
import { getActiveProfile, listVocabulary, type Status } from '../../db/queries'
import styles from './VocabularyScreen.module.css'

const STATUS_GLYPH: Record<Status, string> = {
  none: '⚪',
  struggling: '🔴',
  learning: '🟡',
  solid: '🟢',
}

const STATUS_LABEL: Record<Status, string> = {
  none: 'not started',
  struggling: 'struggling',
  learning: 'learning',
  solid: 'solid',
}

export function VocabularyScreen() {
  const profile = useLiveQuery(() => getActiveProfile(), [])
  const rows = useLiveQuery(
    () => (profile ? listVocabulary(profile.targetLang) : Promise.resolve([])),
    [profile?.targetLang],
  )

  return (
    <div class={styles.screen}>
      <h1 class={styles.title}>Vocabulary</h1>
      {rows === undefined ? (
        <p class={styles.placeholder}>Loading…</p>
      ) : rows.length === 0 ? (
        <p class={styles.placeholder}>No entries match your filter.</p>
      ) : (
        <ul class={styles.list}>
          {rows.map(({ entry, native, recognize, produce }) => (
            <li key={entry.id} class={styles.row}>
              <span class={styles.level}>{entry.cefr ?? '⚝'}</span>
              <span
                class={styles.status}
                title={`recognise: ${STATUS_LABEL[recognize]} / produce: ${STATUS_LABEL[produce]}`}
              >
                {STATUS_GLYPH[recognize]}
                {STATUS_GLYPH[produce]}
              </span>
              <span class={styles.lemma}>
                {entry.lemma}
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

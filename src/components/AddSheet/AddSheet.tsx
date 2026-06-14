import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'preact/hooks'
import { createUserEntry, getActiveProfile, type SearchMatch, searchEntries, setStudy } from '../../db/queries'
import type { PartOfSpeech } from '../../db/types'
import { getRenderer, languageName } from '../../lang'
import styles from './AddSheet.module.css'

const POS_OPTIONS: { value: PartOfSpeech; label: string }[] = [
  { value: 'noun', label: 'Noun' },
  { value: 'verb', label: 'Verb' },
  { value: 'adj', label: 'Adjective' },
  { value: 'adv', label: 'Adverb' },
  { value: 'prep', label: 'Preposition' },
  { value: 'conj', label: 'Conjunction' },
  { value: 'pron', label: 'Pronoun' },
  { value: 'num', label: 'Numeral' },
  { value: 'interj', label: 'Interjection' },
  { value: 'phrase', label: 'Phrase' },
  { value: 'other', label: 'Other' },
]

export function AddSheet({ onClose }: { onClose: () => void }) {
  const profile = useLiveQuery(() => getActiveProfile(), [])
  const inputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [mode, setMode] = useState<'search' | 'new'>('search')

  // new-entry form
  const [lemma, setLemma] = useState('')
  const [pos, setPos] = useState<PartOfSpeech>('noun')
  const [translation, setTranslation] = useState('')
  const [note, setNote] = useState('')

  // Debounced seed search while in search mode. (SPEC §7.4)
  useEffect(() => {
    if (!profile || mode !== 'search') return
    const handle = setTimeout(() => {
      void searchEntries(profile.targetLang, profile.claimedLevel, query).then(setMatches)
    }, 300)
    return () => clearTimeout(handle)
  }, [query, profile?.targetLang, profile?.claimedLevel, mode])

  if (!profile) return null
  const renderer = getRenderer(profile.targetLang)

  function startNew() {
    setLemma(query)
    setMode('new')
  }

  async function addMatch(id: string) {
    await setStudy(id, 'always')
    onClose()
  }

  async function save(another: boolean) {
    if (!lemma.trim() || !translation.trim()) return
    await createUserEntry({
      targetLang: profile!.targetLang,
      learnerLang: profile!.learnerLang,
      lemma,
      pos,
      translation,
      note,
    })
    if (another) {
      setLemma('')
      setTranslation('')
      setNote('')
      setQuery('')
      setMatches([])
      setMode('search')
      inputRef.current?.focus()
    } else {
      onClose()
    }
  }

  const canSave = lemma.trim() !== '' && translation.trim() !== ''

  return (
    <>
      <div class={styles.backdrop} onClick={onClose} />
      <div class={styles.sheet} role="dialog" aria-label="Add a word">
        <header class={styles.header}>
          <button class={styles.close} aria-label="Close" onClick={onClose}>
            ✕
          </button>
          <span class={styles.title}>Add</span>
          <span class={styles.lang}>{languageName(profile.targetLang)}</span>
        </header>

        {mode === 'search' ? (
          <div class={styles.body}>
            <input
              ref={inputRef}
              class={styles.input}
              type="text"
              autofocus
              placeholder={`A word or phrase in ${languageName(profile.targetLang)}`}
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />

            {matches.length > 0 ? (
              <>
                <ul class={styles.matches}>
                  {matches.map(({ entry, native, inStudySet }) => {
                    const inner = (
                      <>
                        <span class={styles.matchLevel}>{entry.cefr ?? '⚝'}</span>
                        <span class={styles.matchLemma}>{renderer.renderLemma(entry)}</span>
                        {native ? <span class={styles.matchNative}>→ {native}</span> : null}
                        {inStudySet ? (
                          <span class={styles.matchAdded}>Added</span>
                        ) : (
                          <span class={styles.matchAdd}>Add</span>
                        )}
                      </>
                    )
                    return (
                      <li key={entry.id}>
                        {inStudySet ? (
                          <div class={styles.match}>{inner}</div>
                        ) : (
                          <button class={styles.match} onClick={() => void addMatch(entry.id)}>
                            {inner}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <button class={styles.linkButton} onClick={startNew}>
                  Save as a new entry instead
                </button>
              </>
            ) : query.trim() ? (
              <button class={styles.createButton} onClick={startNew}>
                Create “{query.trim()}” as a new entry
              </button>
            ) : (
              <p class={styles.hint}>Type a word or phrase to add it to your study set.</p>
            )}
          </div>
        ) : (
          <div class={styles.body}>
            <label class={styles.field}>
              <span class={styles.fieldLabel}>Word or phrase</span>
              <input class={styles.input} type="text" value={lemma} onInput={(e) => setLemma((e.target as HTMLInputElement).value)} />
            </label>
            <label class={styles.field}>
              <span class={styles.fieldLabel}>Part of speech</span>
              <select class={`${styles.input} ${styles.select}`} value={pos} onChange={(e) => setPos((e.target as HTMLSelectElement).value as PartOfSpeech)}>
                {POS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label class={styles.field}>
              <span class={styles.fieldLabel}>Translation ({languageName(profile.learnerLang)})</span>
              <input class={styles.input} type="text" value={translation} onInput={(e) => setTranslation((e.target as HTMLInputElement).value)} />
            </label>
            <label class={styles.field}>
              <span class={styles.fieldLabel}>Note (optional)</span>
              <textarea class={styles.input} rows={2} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
            </label>

            <div class={styles.actions}>
              <button class={styles.secondary} disabled={!canSave} onClick={() => void save(true)}>
                Save & add another
              </button>
              <button class={styles.primary} disabled={!canSave} onClick={() => void save(false)}>
                Save
              </button>
            </div>
            <button class={styles.linkButton} onClick={() => setMode('search')}>
              Back to search
            </button>
          </div>
        )}
      </div>
    </>
  )
}

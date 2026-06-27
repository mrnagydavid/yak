import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'preact/hooks'
import { createUserEntry, getActiveProfile, type SearchMatch, searchEntries, setStudy } from '../../db/queries'
import type { EnrichmentCandidate, PartOfSpeech } from '../../db/types'
import { enrich } from '../../enrichment'
import { getRenderer, languageName } from '../../lang'
import { EntryEditor } from '../EntryEditor/EntryEditor'
import { POS_OPTIONS } from '../posOptions'
import styles from './AddSheet.module.css'

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
  const [ipa, setIpa] = useState('')
  const [gender, setGender] = useState<string | undefined>()
  const [inflections, setInflections] = useState<Record<string, string> | undefined>()
  // new-entry sub-phases: looking up enrichment → (pick a sense) → fill the form.
  const [phase, setPhase] = useState<'loading' | 'picking' | 'form'>('form')
  const [candidates, setCandidates] = useState<EnrichmentCandidate[]>([])

  // After adding a seed match, annotate it (note/examples/translation override). (SPEC §7.4)
  const [annotateId, setAnnotateId] = useState<string | null>(null)

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

  function applyCandidate(c?: EnrichmentCandidate, word: string = lemma) {
    if (!c) return
    setPos(c.pos)
    setGender(c.gender)
    setInflections(c.inflections)
    // The gloss is the English definition — prefill the translation with it (editable).
    if (c.gloss) setTranslation(c.gloss)
    // ipa-dict often returns a verb's present-tense pronunciation; correct it to the infinitive
    // now that we know the POS and present form. (Same fix as the shipped seed.)
    if (c.pos === 'verb' && renderer.fixVerbIpa) {
      setIpa((prev) => (prev ? (renderer.fixVerbIpa!(prev, word, c.inflections?.presens) ?? '') : prev))
    }
  }

  function startNew() {
    const word = query.trim()
    setLemma(word)
    setMode('new')
    setPhase('loading')
    setIpa('')
    setTranslation('')
    setGender(undefined)
    setInflections(undefined)
    setCandidates([])
    // Fire enrichment (ipa-dict + Wiktionary); blocking until it resolves. (SPEC §10)
    void enrich(profile!.targetLang, word).then((r) => {
      if (r.ipa) setIpa(r.ipa)
      if (r.candidates.length > 1) {
        setCandidates(r.candidates)
        setPhase('picking')
      } else {
        applyCandidate(r.candidates[0], word)
        setPhase('form')
      }
    })
  }

  function candidateLabel(c: EnrichmentCandidate): string {
    const word = lemma.trim()
    if (c.gender) return `${c.gender} ${word}`
    if (c.pos === 'verb') return `att ${word}`
    return word
  }

  async function addMatch(id: string) {
    await setStudy(id, 'always')
    setAnnotateId(id) // open the annotation step; closing it closes the whole Add flow
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
      ipa,
      gender,
      inflections,
    })
    if (another) {
      setLemma('')
      setTranslation('')
      setNote('')
      setIpa('')
      setGender(undefined)
      setInflections(undefined)
      setPhase('form')
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
        ) : phase === 'loading' ? (
          <div class={styles.body}>
            <div class={styles.loading}>
              <span class={styles.spinner} />
              <span>Looking up “{lemma}” …</span>
            </div>
          </div>
        ) : phase === 'picking' ? (
          <div class={styles.body}>
            <p class={styles.fieldLabel}>“{lemma}” has several senses — pick one:</p>
            <ul class={styles.matches}>
              {candidates.map((c, i) => (
                <li key={i}>
                  <button
                    class={styles.candidate}
                    onClick={() => {
                      applyCandidate(c)
                      setPhase('form')
                    }}
                  >
                    <span class={styles.matchLemma}>{candidateLabel(c)}</span>
                    <span class={styles.matchNative}>
                      {POS_OPTIONS.find((o) => o.value === c.pos)?.label ?? c.pos}
                      {c.gloss ? ` — ${c.gloss}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button class={styles.linkButton} onClick={() => setPhase('form')}>
              None of these — fill in manually
            </button>
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
              <span class={styles.fieldLabel}>IPA (optional)</span>
              <input class={styles.input} type="text" value={ipa} onInput={(e) => setIpa((e.target as HTMLInputElement).value)} />
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

      {annotateId ? (
        <EntryEditor
          entryId={annotateId}
          translationLang={profile.learnerLang}
          title="Add a note"
          onClose={onClose}
        />
      ) : null}
    </>
  )
}

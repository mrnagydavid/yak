import { useEffect, useState } from 'preact/hooks'
import { getEntryEditData, updateUserEntry, upsertOverlay } from '../../db/queries'
import type { Entry, PartOfSpeech } from '../../db/types'
import { getRenderer, languageName } from '../../lang'
import { POS_OPTIONS } from '../posOptions'
import styles from './EntryEditor.module.css'

/**
 * Edits an entry. User entries get full editing (lemma, POS, translation, note, examples);
 * seed entries get overlay-only editing (note, examples, translation override) so the seed
 * row stays pristine. Reused by Word Detail, the in-session pencil, and Add. (SPEC §7.2/7.5)
 */
export function EntryEditor({
  entryId,
  translationLang,
  title = 'Edit',
  onClose,
}: {
  entryId: string
  translationLang: string
  title?: string
  onClose: () => void
}) {
  const [entry, setEntry] = useState<Entry | null>(null)
  const [lemma, setLemma] = useState('')
  const [pos, setPos] = useState<PartOfSpeech>('noun')
  const [translation, setTranslation] = useState('')
  const [note, setNote] = useState('')
  const [examples, setExamples] = useState<string[]>([])
  const [inflections, setInflections] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    void getEntryEditData(entryId).then((d) => {
      if (!alive || !d) return
      setEntry(d.entry)
      setLemma(d.entry.lemma)
      setPos(d.entry.pos)
      setInflections(d.entry.inflections ?? {})
      setNote(d.overlay?.noteText ?? '')
      setExamples(d.overlay?.customExamples ?? [])
      // For user entries the translation field is the real native lemma; for seed entries
      // it's the overlay override.
      setTranslation(d.entry.source === 'user' ? (d.nativeLemma ?? '') : (d.overlay?.customTranslation ?? ''))
    })
    return () => {
      alive = false
    }
  }, [entryId])

  const isUser = entry?.source === 'user'
  // POS-specific inflection slots (declension/conjugation/comparison), for user entries.
  const slots = entry ? getRenderer(entry.lang).inflectionSlots(pos) : []

  async function save() {
    if (!entry) return
    if (isUser) {
      const inf: Record<string, string> = {}
      for (const s of slots) {
        const value = (inflections[s.key] ?? '').trim()
        if (value) inf[s.key] = value
      }
      await updateUserEntry(entryId, { lemma, pos, translation, inflections: inf })
      await upsertOverlay(entryId, { noteText: note, customExamples: examples }, translationLang)
    } else {
      await upsertOverlay(entryId, { noteText: note, customExamples: examples, customTranslation: translation }, translationLang)
    }
    onClose()
  }

  const setExample = (i: number, value: string) => setExamples((xs) => xs.map((x, j) => (j === i ? value : x)))
  const removeExample = (i: number) => setExamples((xs) => xs.filter((_, j) => j !== i))

  return (
    <>
      <div class={styles.backdrop} onClick={onClose} />
      <div class={styles.sheet} role="dialog" aria-label={title}>
        <header class={styles.header}>
          <button class={styles.close} aria-label="Close" onClick={onClose}>
            ✕
          </button>
          <span class={styles.title}>{title}</span>
        </header>

        <div class={styles.body}>
          {!entry ? (
            <p class={styles.fieldLabel}>Loading…</p>
          ) : (
            <>
              {isUser ? (
                <>
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
                    <span class={styles.fieldLabel}>Translation ({languageName(translationLang)})</span>
                    <input class={styles.input} type="text" value={translation} onInput={(e) => setTranslation((e.target as HTMLInputElement).value)} />
                  </label>
                  {slots.map((s) => (
                    <label key={s.key} class={styles.field}>
                      <span class={styles.fieldLabel}>{s.label}</span>
                      <input
                        class={styles.input}
                        type="text"
                        value={inflections[s.key] ?? ''}
                        onInput={(e) => setInflections({ ...inflections, [s.key]: (e.target as HTMLInputElement).value })}
                      />
                    </label>
                  ))}
                </>
              ) : null}

              <label class={styles.field}>
                <span class={styles.fieldLabel}>Note</span>
                <textarea class={styles.input} rows={2} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
              </label>

              <div class={styles.field}>
                <span class={styles.fieldLabel}>Examples</span>
                {examples.map((ex, i) => (
                  <div key={i} class={styles.exampleRow}>
                    <input class={styles.input} type="text" value={ex} onInput={(e) => setExample(i, (e.target as HTMLInputElement).value)} />
                    <button class={styles.remove} aria-label="Remove example" onClick={() => removeExample(i)}>
                      ✕
                    </button>
                  </div>
                ))}
                <button class={styles.addExample} onClick={() => setExamples((xs) => [...xs, ''])}>
                  + Add example
                </button>
              </div>

              {!isUser ? (
                <label class={styles.field}>
                  <span class={styles.fieldLabel}>Translation override</span>
                  <input class={styles.input} type="text" value={translation} onInput={(e) => setTranslation((e.target as HTMLInputElement).value)} />
                </label>
              ) : null}

              <div class={styles.actions}>
                <button class={styles.secondary} onClick={onClose}>
                  Cancel
                </button>
                <button class={styles.primary} onClick={() => void save()}>
                  Save
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

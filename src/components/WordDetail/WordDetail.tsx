import { useLiveQuery } from 'dexie-react-hooks'
import { route } from 'preact-router'
import { useState } from 'preact/hooks'
import {
  deleteUserEntry,
  deriveStatus,
  getWordDetail,
  resetOverlay,
  resetProduction,
  resetSkill,
  setStudy,
  type Status,
} from '../../db/queries'
import type { StudyPref } from '../../db/types'
import type { InflectionDisplay } from '../../lang'
import { getRenderer } from '../../lang'
import { EntryEditor } from '../EntryEditor/EntryEditor'
import { SpeakButton, WiktionaryLink } from '../WordActions/WordActions'
import styles from './WordDetail.module.css'

interface Pending {
  message: string
  confirmLabel: string
  run: () => Promise<void>
}

const STUDY_OPTIONS: { value: StudyPref; label: string }[] = [
  { value: 'skip', label: 'Skip' },
  { value: 'auto', label: 'Auto' },
  { value: 'always', label: 'Study' },
]

const STATUS_GLYPH: Record<Status, string> = { none: '⚪', struggling: '🔴', learning: '🟡', solid: '🟢' }
const STATUS_LABEL: Record<Status, string> = {
  none: 'Not started',
  struggling: 'Struggling',
  learning: 'Learning',
  solid: 'Solid',
}

function relativeTime(ts: number, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const sec = (ts - now) / 1000
  const abs = Math.abs(sec)
  if (abs < 60) return rtf.format(Math.round(sec), 'second')
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour')
  if (abs < 2592000) return rtf.format(Math.round(sec / 86400), 'day')
  if (abs < 31536000) return rtf.format(Math.round(sec / 2592000), 'month')
  return rtf.format(Math.round(sec / 31536000), 'year')
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Full inflection display with labels (unlike the bare card grid).
function InflectionDetail({ display }: { display: InflectionDisplay }) {
  if (display.table) {
    const { columns, rows } = display.table
    return (
      <table class={styles.table}>
        <thead>
          <tr>
            <th />
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th class={styles.rowHead}>{r.label}</th>
              {r.cells.map((cell, i) => (
                <td key={i}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (display.rows.length === 0) return null
  return (
    <table class={styles.table}>
      <tbody>
        {display.rows.map((r) => (
          <tr key={r.label}>
            <th class={styles.rowHead}>{cap(r.label)}</th>
            <td>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function WordDetail({ id }: { id?: string }) {
  const data = useLiveQuery(() => (id ? getWordDetail(id) : Promise.resolve(null)), [id])
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)

  if (data === undefined) return <div class={styles.screen}>Loading…</div>
  if (data === null) return <div class={styles.screen}>Word not found.</div>

  const { entry, natives, recognize, meanings, lastPracticed, overlay, autoIncluded, senseSummary } = data
  const multiMeaning = meanings.length > 1
  const renderer = getRenderer(entry.lang)
  const inflections = renderer.renderInflections(entry)
  const features = renderer.renderFeatures(entry)
  const ipa = renderer.showIpa ? entry.pronunciation.ipa : undefined
  // Browse view is per word — show every meaning's examples (seed examples are tagged by meaning) plus
  // the user's own. (per-sense examples, §4.8)
  const examples = [...(entry.examples ?? []).map((e) => e.text), ...(overlay?.customExamples ?? [])]
  const translationLang = natives[0]?.lang ?? 'en'

  async function runPending() {
    if (!pending) return
    await pending.run()
    setPending(null)
  }

  return (
    <div class={styles.screen}>
      <div class={styles.topbar}>
        <a class={styles.back} href="/vocabulary" aria-label="Back to vocabulary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </a>
        <button class={styles.iconButton} aria-label="Edit note, examples, translation" onClick={() => setEditing(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      </div>

      <header class={styles.header}>
        <h1 class={styles.lemma}>
          {renderer.renderLemma(entry)}
          {entry.disambiguator ? <span class={styles.disambig}> ({entry.disambiguator})</span> : null}
        </h1>
        <div class={styles.badges}>
          <span class={styles.levelBadge}>{entry.cefr ?? '⚝'}</span>
          {features.map((f) => (
            <span key={f.label} class={`${styles.badge} ${f.kind === 'gender-ett' ? styles.ett : styles.en}`}>
              {f.label}
            </span>
          ))}
          {entry.source === 'user' ? <span class={styles.yours}>Your entry</span> : null}
        </div>
      </header>

      <section class={`${styles.section} ${styles.pronunciation}`}>
        {ipa ? <span class={styles.ipa}>/{ipa}/</span> : null}
        {/* Suppressed when the lemma is pronounced differently across senses (kort, ton) — TTS can't
            pick the right one; the per-sense IPA above still shows. */}
        {entry.pronunciation.ambiguous ? null : <SpeakButton text={entry.lemma} lang={entry.lang} />}
        <WiktionaryLink lemma={entry.lemma} lang={entry.lang} />
      </section>

      {inflections.table || inflections.rows.length ? (
        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>Forms</h2>
          <InflectionDetail display={inflections} />
        </section>
      ) : null}

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>{natives.length > 1 ? 'Translations' : 'Translation'}</h2>
        {natives.length === 0 ? (
          <p class={styles.muted}>—</p>
        ) : overlay?.customTranslation ? (
          <>
            <ul class={`${styles.translations} ${styles.struck}`}>
              {natives.map((n) => (
                <li key={n.id}>{getRenderer(n.lang).renderLemma(n)}</li>
              ))}
            </ul>
            <p class={styles.overrideNote}>(translation overridden by you)</p>
            <p class={styles.override}>{overlay.customTranslation}</p>
          </>
        ) : (
          <ul class={styles.translations}>
            {natives.map((n) => (
              <li key={n.id}>{getRenderer(n.lang).renderLemma(n)}</li>
            ))}
          </ul>
        )}
        {entry.subDefinitions?.length ? (
          <>
            <p class={styles.subdefsLabel}>Can also mean:</p>
            <ul class={styles.subdefs}>
              {entry.subDefinitions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {senseSummary && (senseSummary.synonyms.length > 0 || senseSummary.meaningsLearned > 1) ? (
        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>In your vocabulary</h2>
          {senseSummary.meaningsLearned > 1 ? (
            <p class={styles.muted}>You’ve learned {senseSummary.meaningsLearned} meanings of “{senseSummary.concept}”.</p>
          ) : null}
          {senseSummary.synonyms.length > 0 ? (
            <p class={styles.muted}>Synonyms you know: {senseSummary.synonyms.join(', ')}.</p>
          ) : null}
        </section>
      ) : null}

      {overlay?.noteText ? (
        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>Note</h2>
          <p class={styles.note}>{overlay.noteText}</p>
        </section>
      ) : null}

      {examples.length ? (
        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>Examples</h2>
          <ul class={styles.examples}>
            {examples.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Progress</h2>
        <div class={styles.progress}>
          {/* Recognition is per WORD — one line, carried by the primary meaning. */}
          <span>
            {STATUS_GLYPH[deriveStatus(recognize)]} Recognition · {STATUS_LABEL[deriveStatus(recognize)]}
          </span>
          {/* Production is per MEANING — one line for a single-meaning word, otherwise one per meaning. */}
          {multiMeaning ? (
            <>
              <span class={styles.progressLabel}>Production</span>
              {meanings.map((m) => (
                <span key={m.translationId} class={styles.progressMeaning}>
                  {STATUS_GLYPH[deriveStatus(m.produce)]} {m.native} · {STATUS_LABEL[deriveStatus(m.produce)]}
                </span>
              ))}
            </>
          ) : (
            <span>
              {STATUS_GLYPH[deriveStatus(meanings[0]?.produce)]} Production · {STATUS_LABEL[deriveStatus(meanings[0]?.produce)]}
            </span>
          )}
        </div>
        <p class={styles.muted}>
          {lastPracticed ? `Last practiced ${relativeTime(lastPracticed)}` : 'Not practiced yet'}
        </p>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Practice</h2>
        <div class={styles.segmented} role="radiogroup">
          {STUDY_OPTIONS.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={entry.study === o.value}
              class={`${styles.segment} ${entry.study === o.value ? styles.segmentOn : ''}`}
              onClick={() => void setStudy(entry.id, o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p class={styles.muted}>
          {entry.study === 'always'
            ? 'Always practiced.'
            : entry.study === 'skip'
              ? 'Never practiced.'
              : autoIncluded
                ? 'Auto — in scope, so it’s practiced.'
                : 'Auto — out of scope for your level, so it’s not practiced yet.'}
        </p>
      </section>

      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Manage</h2>
        <div class={styles.manageRow}>
          <button
            class={styles.manage}
            disabled={!recognize}
            onClick={() => setPending({ message: 'Reset recognition progress for this word?', confirmLabel: 'Reset', run: () => resetSkill(entry.id, 'recognize') })}
          >
            Reset recognition
          </button>
          {/* Production reset is per meaning — a single button for one meaning, else one per meaning. */}
          {!multiMeaning ? (
            <button
              class={styles.manage}
              disabled={!meanings[0]?.produce}
              onClick={() => setPending({ message: 'Reset production progress for this word?', confirmLabel: 'Reset', run: () => resetSkill(entry.id, 'produce') })}
            >
              Reset production
            </button>
          ) : null}
        </div>
        {multiMeaning ? (
          <div class={styles.manageRow}>
            {meanings.map((m) => (
              <button
                key={m.translationId}
                class={styles.manage}
                disabled={!m.produce}
                onClick={() =>
                  setPending({
                    message: `Reset production progress for “${m.native}”?`,
                    confirmLabel: 'Reset',
                    run: () => resetProduction(m.translationId),
                  })
                }
              >
                Reset “{m.native}”
              </button>
            ))}
          </div>
        ) : null}
        {entry.source === 'user' ? (
          <button
            class={styles.danger}
            onClick={() =>
              setPending({
                message: 'Delete this word and its progress? This can’t be undone.',
                confirmLabel: 'Delete',
                run: async () => {
                  await deleteUserEntry(entry.id)
                  route('/vocabulary')
                },
              })
            }
          >
            Delete word
          </button>
        ) : overlay ? (
          <button
            class={styles.dangerOutline}
            onClick={() => setPending({ message: 'Discard all your changes (note, examples, translation) for this word?', confirmLabel: 'Reset', run: () => resetOverlay(entry.id) })}
          >
            Reset all changes
          </button>
        ) : null}
      </section>

      {editing ? (
        <EntryEditor entryId={entry.id} translationLang={translationLang} title="Edit word" onClose={() => setEditing(false)} />
      ) : null}

      {pending ? (
        <>
          <div class={styles.backdrop} onClick={() => setPending(null)} />
          <div class={styles.confirm} role="dialog">
            <p>{pending.message}</p>
            <div class={styles.confirmRow}>
              <button class={styles.manage} onClick={() => setPending(null)}>
                Cancel
              </button>
              <button class={styles.danger} onClick={() => void runPending()}>
                {pending.confirmLabel}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

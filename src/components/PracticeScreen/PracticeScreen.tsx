import { useEffect, useState } from 'preact/hooks'
import { getPracticeCardView, type PracticeCardView } from '../../db/queries'
import type { RatingLabel } from '../../srs/fsrs-adapter'
import { composeSession, recordReview } from '../../srs/session-composer'
import { EntryEditor } from '../EntryEditor/EntryEditor'
import { WiktionaryLink } from '../WordActions/WordActions'
import { ProgressBar } from './ProgressBar'
import { RatingButtons } from './RatingButtons'
import {
  dayKey,
  loadPersistedSession,
  persistIndex,
  persistSession,
  resumableSession,
  saveSession,
  setSessionIndex,
} from './session-store'
import { StudyCard } from './StudyCard'
import styles from './PracticeScreen.module.css'

export function PracticeScreen() {
  // The session is composed once per day and kept alive across navigation/refresh (SPEC §7.2):
  // the in-memory store resumes instantly on a tab switch; the persisted record resumes after a
  // page refresh. Only when neither has a session for today do we compose a fresh one.
  const [resumed] = useState(() => resumableSession())
  const [views, setViews] = useState<PracticeCardView[] | null>(resumed?.views ?? null)
  const [index, setIndex] = useState(resumed?.index ?? 0)
  const [revealed, setRevealed] = useState(false)
  // False once a "Push further" yields nothing more, so the button stops being a no-op.
  const [canPushFurther, setCanPushFurther] = useState(resumed?.canPushFurther ?? true)
  const [editing, setEditing] = useState(false)

  async function load(pushFurther = false) {
    const cards = await composeSession(Date.now(), pushFurther)
    const resolved = (await Promise.all(cards.map((c) => getPracticeCardView(c)))).filter(
      (v): v is PracticeCardView => v !== null,
    )
    const nextCanPush = pushFurther ? resolved.length > 0 : true
    setViews(resolved)
    setIndex(0)
    setRevealed(false)
    setCanPushFurther(nextCanPush)
    saveSession({ dayKey: dayKey(), views: resolved, index: 0, canPushFurther: nextCanPush })
    void persistSession(resolved.map((v) => v.card), 0, nextCanPush)
  }

  // Re-hydrate a session saved before a page refresh: re-resolve its lightweight queue into views
  // and restore the cursor. Falls back to composing a fresh session if there's nothing to resume.
  async function resumeOrLoad() {
    const persisted = await loadPersistedSession()
    if (!persisted) {
      await load()
      return
    }
    const resolved = (await Promise.all(persisted.cards.map((c) => getPracticeCardView(c)))).filter(
      (v): v is PracticeCardView => v !== null,
    )
    const restoredIndex = Math.min(persisted.index, resolved.length)
    setViews(resolved)
    setIndex(restoredIndex)
    setRevealed(false)
    setCanPushFurther(persisted.canPushFurther)
    saveSession({
      dayKey: persisted.dayKey,
      views: resolved,
      index: restoredIndex,
      canPushFurther: persisted.canPushFurther,
    })
  }

  useEffect(() => {
    if (views === null) void resumeOrLoad() // no in-memory session → try the persisted one, else compose
  }, [])

  if (views === null) {
    return (
      <div class={styles.screen}>
        <p class={styles.message}>Loading…</p>
      </div>
    )
  }

  if (index >= views.length) {
    return (
      <div class={styles.screen}>
        <div class={styles.caughtUp}>
          <p class={styles.caughtTitle}>You're caught up for today.</p>
          {canPushFurther ? (
            <button class={styles.pushFurther} onClick={() => void load(true)}>
              Push further
            </button>
          ) : (
            <p class={styles.caughtSub}>Nothing more to pull right now.</p>
          )}
        </div>
      </div>
    )
  }

  const view = views[index]
  const isRevealed = revealed || view.card.mode === 'new'

  async function rate(rating: RatingLabel) {
    navigator.vibrate?.(10)
    await recordReview(view.card, rating)
    setRevealed(false)
    setIndex((i) => {
      const next = i + 1
      setSessionIndex(next) // in-memory: leaving mid-session (tab switch) resumes here
      void persistIndex(next) // persisted: a page refresh resumes here too
      return next
    })
  }

  return (
    <div class={styles.screen}>
      <div class={styles.topbar}>
        <ProgressBar value={index} total={views.length} />
        <button class={styles.edit} aria-label="Edit note, examples, translation" onClick={() => setEditing(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      </div>
      <div
        class={`${styles.cardArea} ${isRevealed ? '' : styles.tappable}`}
        onClick={isRevealed ? undefined : () => setRevealed(true)}
      >
        {/* Keyed on the index so each question is a fresh mount — that's what triggers the
            card-in animation when advancing past a rating (tap-to-reveal keeps the same key). */}
        <StudyCard key={index} view={view} revealed={isRevealed} />
      </div>
      {/* Wiktionary link for the Swedish word — pinned just above the rating buttons; shown only once
          revealed (so it can't hint the answer in production). The footer always reserves its space, so
          revealing doesn't shrink the card area and nudge the prompt upward. */}
      <div class={styles.wiktFooter}>
        {isRevealed ? <WiktionaryLink lemma={view.target.lemma} lang={view.target.lang} /> : null}
      </div>
      <RatingButtons mode={view.card.mode} onRate={rate} />

      {editing ? (
        <EntryEditor
          entryId={view.target.id}
          translationLang={view.native?.lang ?? 'en'}
          title="Edit word"
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  )
}

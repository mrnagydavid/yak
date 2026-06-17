import { useEffect, useState } from 'preact/hooks'
import { getPracticeCardView, type PracticeCardView } from '../../db/queries'
import type { RatingLabel } from '../../srs/fsrs-adapter'
import { composeSession, recordReview } from '../../srs/session-composer'
import { EntryEditor } from '../EntryEditor/EntryEditor'
import { ProgressBar } from './ProgressBar'
import { RatingButtons } from './RatingButtons'
import { dayKey, resumableSession, saveSession, setSessionIndex } from './session-store'
import { StudyCard } from './StudyCard'
import styles from './PracticeScreen.module.css'

export function PracticeScreen() {
  // The session is composed once per day and kept in a module-level store, so switching tabs (which
  // unmounts this route) resumes the same queue and position instead of restarting. (SPEC §7.2)
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
  }

  useEffect(() => {
    if (views === null) void load() // resume an existing session, otherwise compose a fresh one
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
      setSessionIndex(next) // remember where we are, so leaving mid-session resumes here
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
        <StudyCard view={view} revealed={isRevealed} />
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

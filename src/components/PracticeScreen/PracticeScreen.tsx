import { useEffect, useState } from 'preact/hooks'
import { getPracticeCardView, type PracticeCardView } from '../../db/queries'
import type { RatingLabel } from '../../srs/fsrs-adapter'
import { composeSession, recordReview } from '../../srs/session-composer'
import { ProgressBar } from './ProgressBar'
import { RatingButtons } from './RatingButtons'
import { StudyCard } from './StudyCard'
import styles from './PracticeScreen.module.css'

export function PracticeScreen() {
  // The session is composed once when the screen opens and held as a snapshot — rating a
  // card persists its state but does not recompose the queue mid-sitting. (SPEC §7.2)
  const [views, setViews] = useState<PracticeCardView[] | null>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  // False once a "Push further" yields nothing more, so the button stops being a no-op.
  const [canPushFurther, setCanPushFurther] = useState(true)

  async function load(pushFurther = false) {
    const cards = await composeSession(Date.now(), pushFurther)
    const resolved = (await Promise.all(cards.map((c) => getPracticeCardView(c)))).filter(
      (v): v is PracticeCardView => v !== null,
    )
    setViews(resolved)
    setIndex(0)
    setRevealed(false)
    if (pushFurther) setCanPushFurther(resolved.length > 0)
  }

  useEffect(() => {
    void load()
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
    setIndex((i) => i + 1)
  }

  return (
    <div class={styles.screen}>
      <ProgressBar value={index} total={views.length} />
      <div
        class={`${styles.cardArea} ${isRevealed ? '' : styles.tappable}`}
        onClick={isRevealed ? undefined : () => setRevealed(true)}
      >
        <StudyCard view={view} revealed={isRevealed} />
      </div>
      <RatingButtons mode={view.card.mode} onRate={rate} />
    </div>
  )
}

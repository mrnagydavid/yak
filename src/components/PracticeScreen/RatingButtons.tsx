import type { RatingLabel } from '../../srs/fsrs-adapter'
import type { CardMode } from '../../srs/session-composer'
import styles from './RatingButtons.module.css'

interface Button {
  label: string
  rating: RatingLabel
  cls: string
}

// Practice/calibration cards are recall attempts → the four self-eval grades. (SPEC §6.5)
const PRACTICE_BUTTONS: Button[] = [
  { label: "Didn't know", rating: 'again', cls: styles.again },
  { label: 'Hard', rating: 'hard', cls: styles.hard },
  { label: 'Knew it', rating: 'good', cls: styles.good },
  { label: 'Easy', rating: 'easy', cls: styles.easy },
]

// New cards are a study moment, not a recall test — only two honest choices.
const NEW_BUTTONS: Button[] = [
  { label: 'New to me', rating: 'good', cls: styles.good },
  { label: 'Already knew it', rating: 'easy', cls: styles.easy },
]

export function RatingButtons({
  mode,
  onRate,
}: {
  mode: CardMode
  onRate: (rating: RatingLabel) => void
}) {
  const buttons = mode === 'new' ? NEW_BUTTONS : PRACTICE_BUTTONS
  return (
    <div class={styles.buttons}>
      {buttons.map((b) => (
        <button key={b.rating} class={`${styles.btn} ${b.cls}`} onClick={() => onRate(b.rating)}>
          {b.label}
        </button>
      ))}
    </div>
  )
}

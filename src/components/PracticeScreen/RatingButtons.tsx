import type { RatingLabel } from '../../srs/fsrs-adapter'
import styles from './RatingButtons.module.css'

// Four self-evaluation buttons mapped to FSRS ratings. (SPEC §6.5)
const BUTTONS: { label: string; rating: RatingLabel; cls: string }[] = [
  { label: "Didn't know", rating: 'again', cls: styles.again },
  { label: 'Hard', rating: 'hard', cls: styles.hard },
  { label: 'Knew it', rating: 'good', cls: styles.good },
  { label: 'Easy', rating: 'easy', cls: styles.easy },
]

export function RatingButtons({ onRate }: { onRate: (rating: RatingLabel) => void }) {
  return (
    <div class={styles.buttons}>
      {BUTTONS.map((b) => (
        <button key={b.rating} class={`${styles.btn} ${b.cls}`} onClick={() => onRate(b.rating)}>
          {b.label}
        </button>
      ))}
    </div>
  )
}

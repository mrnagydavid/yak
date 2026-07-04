import type { ClaimedLevel } from '../../srs/level-progress'
import { nextLevel } from '../../srs/levels'
import styles from './LevelUpModal.module.css'

const LEVEL_LABEL: Record<ClaimedLevel, string> = {
  'below-A1': 'below A1',
  A1: 'A1',
  A2: 'A2',
  B1: 'B1',
  B2: 'B2',
  C1: 'C1',
  C2: 'C2',
}

/**
 * Celebratory prompt shown when the learner has cleared the band above their level (see level-progress).
 * Accepting raises the claimed level to `target`; the band above it (`beyond`) becomes the new-word pool.
 * "Not yet" snoozes it for the day. Copy names `target` as what they learned and `beyond` as what's next.
 */
export function LevelUpModal({
  target,
  onAccept,
  onDismiss,
}: {
  target: ClaimedLevel
  onAccept: () => void
  onDismiss: () => void
}) {
  const beyond = nextLevel(target)
  return (
    <div class={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="levelup-title">
      <div class={styles.card}>
        <div class={styles.emoji} aria-hidden="true">
          🎉
        </div>
        <h2 id="levelup-title" class={styles.title}>
          You've learned every {LEVEL_LABEL[target]} word!
        </h2>
        <p class={styles.body}>
          {beyond ? (
            <>
              Move up to {LEVEL_LABEL[target]} and you'll start learning {LEVEL_LABEL[beyond]} words next.
            </>
          ) : (
            <>Move up to {LEVEL_LABEL[target]} — you've reached the top level.</>
          )}
        </p>
        <button type="button" class={styles.accept} onClick={onAccept}>
          Move up to {LEVEL_LABEL[target]}
        </button>
        <button type="button" class={styles.dismiss} onClick={onDismiss}>
          Not yet
        </button>
      </div>
    </div>
  )
}

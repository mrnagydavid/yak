import type { DrillSessionLog } from '../../db/types'
import type { DrillQuestion } from '../../drills/types'
import { getRenderer } from '../../lang'
import styles from './PracticePlus.module.css'

/** End-of-session summary — shown whether the batch was finished or exited early. Lists the missed
 *  words (with their correct article) so it doubles as a quick review. Language-agnostic. */
export function DrillStats({
  log,
  missed,
  onDone,
}: {
  log: DrillSessionLog
  missed: DrillQuestion[]
  onDone: () => void
}) {
  const pct = log.attempted > 0 ? Math.round((log.correct / log.attempted) * 100) : 0

  return (
    <div class={styles.statsScreen}>
      <h2 class={styles.statsTitle}>{log.endedEarly ? 'Session ended' : 'Nice work!'}</h2>

      {log.attempted > 0 ? (
        <>
          <span class={styles.statsPct}>{pct}%</span>
          <p class={styles.statsLine}>
            {log.correct} correct of {log.attempted} questions
          </p>
        </>
      ) : (
        <p class={styles.muted}>No words answered.</p>
      )}

      {missed.length > 0 ? (
        <div class={styles.missed}>
          <h3 class={styles.missedTitle}>Worth another look</h3>
          <ul class={styles.missedList}>
            {missed.map((q) => (
              <li key={q.entry.id} class={styles.missedItem}>
                <span class={styles.missedWord}>{getRenderer(q.entry.lang).renderLemma(q.entry)}</span>
                <span class={styles.missedGloss}>{q.gloss}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : log.attempted > 0 ? (
        <p class={styles.muted}>No mistakes — every one correct.</p>
      ) : null}

      <button type="button" class={styles.done} onClick={onDone}>
        Done
      </button>
    </div>
  )
}

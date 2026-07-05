import type { DrillSessionLog } from '../../db/types'
import type { DrillQuestion } from '../../drills/types'
import { getRenderer } from '../../lang'
import styles from './PracticePlus.module.css'

/**
 * End-of-session summary. A drill runs until every word is cleared (answered right at least once), so
 * "% correct" is meaningless — everyone ends at 100%. What matters is FIRST-TRY accuracy: how many you
 * already knew vs. how many you had to relearn this sitting. On an early exit it reports how much of the
 * board got cleared. The missed list doubles as a quick review. Language-agnostic.
 */
export function DrillStats({
  log,
  missed,
  onDone,
}: {
  log: DrillSessionLog
  missed: DrillQuestion[]
  onDone: () => void
}) {
  const allCleared = log.words > 0 && log.cleared >= log.words
  const neededAnotherGo = Math.max(0, log.cleared - log.firstTry)

  return (
    <div class={styles.statsScreen}>
      <h2 class={styles.statsTitle}>{allCleared ? 'All done! 🎉' : 'Session ended'}</h2>

      {log.words > 0 ? (
        <>
          <span class={styles.statsPct}>
            {log.firstTry}/{log.words}
          </span>
          <p class={styles.statsLine}>known on the first try</p>
          {!allCleared ? (
            <p class={styles.muted}>
              Cleared {log.cleared} of {log.words} — the rest are still waiting.
            </p>
          ) : neededAnotherGo > 0 ? (
            <p class={styles.muted}>
              {neededAnotherGo} took another go before {neededAnotherGo === 1 ? 'it' : 'they'} stuck.
            </p>
          ) : (
            <p class={styles.muted}>Every word on the first try — nice.</p>
          )}
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
      ) : null}

      <button type="button" class={styles.done} onClick={onDone}>
        Done
      </button>
    </div>
  )
}
